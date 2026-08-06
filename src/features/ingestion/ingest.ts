import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import {
  announcementAttachments,
  announcements,
  db,
  ingestionRuns,
  type AnnouncementSource,
} from "@/db";
import { createEmbeddings } from "@/lib/embedding";
import { isAiEnabled } from "@/lib/env";
import { contentHash, normalizeWhitespace, truncate } from "@/lib/text";

import { parseAttachment } from "./attachment-parser";
import { bizinfoAdapter, fetchBizinfoByUrl } from "./sources/bizinfo";
import { egbizAdapter } from "./sources/egbiz";
import { kStartupAdapter } from "./sources/k-startup";
import type {
  AnnouncementSourceAdapter,
  FetchOptions,
  IngestionResult,
  RawAnnouncement,
} from "./types";

export const adapters: AnnouncementSourceAdapter[] = [
  kStartupAdapter,
  bizinfoAdapter,
  egbizAdapter,
];

export function getAdapter(
  source: AnnouncementSource,
): AnnouncementSourceAdapter | undefined {
  return adapters.find((adapter) => adapter.source === source);
}

export interface IngestOptions extends FetchOptions {
  /** DB 에 쓰지 않고 수집만 해본다 — 셀렉터/필드명 확인용 */
  dryRun?: boolean;
  /** 첨부파일 텍스트 추출 단계를 건너뛴다 */
  skipAttachments?: boolean;
  /** 임베딩 생성을 건너뛴다 */
  skipEmbedding?: boolean;
  /**
   * 기존 공고를 만나도 멈추지 않고 `maxPages` 까지 끝까지 훑는다.
   * 목록 뒤쪽에 빠진 공고를 메우는 백필용 — 평소에는 쓰지 않는다.
   */
  full?: boolean;
}

/**
 * 이 소스로 이미 담아둔 공고의 externalId.
 * 어댑터에 "여기서부터는 아는 공고" 라고 알려주는 용도라 id 만 읽는다.
 */
async function loadKnownExternalIds(
  source: AnnouncementSource,
): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: announcements.externalId })
    .from(announcements)
    .where(eq(announcements.source, source));

  return new Set(rows.map((row) => row.externalId));
}

/**
 * 같은 작업이 동시에 두 번 도는 것을 막는다 (화면 버튼 연타, CLI 와 화면이 겹치는 경우).
 * 결과 자체는 upsert 라 안전하지만, 유료 API 를 두 번 호출하는 게 문제다.
 *
 * 세션 단위 advisory lock 이라 풀에서 전용 커넥션을 하나 잡아 쓴다.
 * 수집과 임베딩은 키가 달라 서로를 막지 않는다(수집이 내부에서 임베딩을 호출한다).
 */
const INGEST_LOCK_KEY = 811_001;
const EMBED_LOCK_KEY = 811_002;

/**
 * 잠금을 잡고 해제 함수를 돌려준다. 실패하면 null.
 * 백그라운드 임베딩처럼 "요청이 끝난 뒤에도 계속 도는" 작업에 쓴다 —
 * 응답 전에 잠가 두어야 화면이 곧바로 「진행 중」을 볼 수 있다.
 */
export async function acquireEmbeddingLock(): Promise<{
  release: () => Promise<void>;
} | null> {
  const client = await db.$client.connect();
  const { rows } = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [EMBED_LOCK_KEY],
  );

  if (!rows[0]?.locked) {
    client.release();
    return null;
  }

  return {
    release: async () => {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [EMBED_LOCK_KEY]);
      } finally {
        client.release();
      }
    },
  };
}

/** 임베딩이 지금 돌고 있는지 (잠금 점유 여부로 판단) */
export async function isEmbeddingRunning(): Promise<boolean> {
  const lock = await acquireEmbeddingLock();
  if (!lock) return true;
  await lock.release();
  return false;
}

async function withAdvisoryLock<T>(
  key: number,
  run: () => Promise<T>,
  busyValue: T,
): Promise<T> {
  const client = await db.$client.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [key],
    );
    if (!rows[0]?.locked) {
      console.warn(`[ingest] 이미 실행 중이라 건너뜁니다 (lock ${key})`);
      return busyValue;
    }

    try {
      return await run();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

/** 임베딩에 넣을 원문 — 제목 + 지원대상 + 본문 + 첨부 추출 텍스트 */
function buildEmbeddingSource(input: {
  title: string;
  targetAudience?: string | null;
  category?: string | null;
  region?: string | null;
  content: string;
  attachmentTexts?: string[];
}): string {
  const parts = [
    input.title,
    input.category ? `분야: ${input.category}` : null,
    input.region ? `지역: ${input.region}` : null,
    input.targetAudience ? `지원대상: ${input.targetAudience}` : null,
    input.content,
    ...(input.attachmentTexts ?? []),
  ].filter(Boolean);

  return normalizeWhitespace(parts.join("\n\n"));
}

async function upsertAnnouncement(raw: RawAnnouncement) {
  const values = {
    source: raw.source,
    externalId: raw.externalId,
    title: raw.title,
    content: raw.content,
    summary: raw.summary ?? truncate(raw.content, 300),
    url: raw.url,
    sourceUrl: raw.sourceUrl ?? null,
    category: raw.category ?? null,
    region: raw.region ?? null,
    targetAudience: raw.targetAudience ?? null,
    agency: raw.agency ?? null,
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
  };

  // xmax = 0 이면 INSERT, 아니면 UPDATE — 왕복 한 번으로 신규/갱신을 구분한다
  const [row] = await db
    .insert(announcements)
    .values(values)
    .onConflictDoUpdate({
      target: [announcements.source, announcements.externalId],
      set: {
        title: values.title,
        content: values.content,
        summary: values.summary,
        url: values.url,
        sourceUrl: values.sourceUrl,
        category: values.category,
        region: values.region,
        targetAudience: values.targetAudience,
        agency: values.agency,
        startDate: values.startDate,
        endDate: values.endDate,
        updatedAt: new Date(),
        /**
         * 임베딩 원문에 들어가는 필드가 실제로 바뀌었을 때만 해시를 비워
         * 다음 embedPendingAnnouncements() 의 대상이 되게 한다.
         *
         * 이게 없으면 공고 내용이 갱신돼도 예전 임베딩이 그대로 남아 추천이 계속 어긋난다.
         * 반대로 매번 비우면 바뀐 게 없어도 재임베딩해 API 비용만 나간다.
         * (ON CONFLICT 절에서 테이블명은 기존 행, excluded 는 새로 들어온 값을 가리킨다)
         */
        embeddingHash: sql`CASE WHEN
              ${announcements.title}          IS DISTINCT FROM excluded.title
           OR ${announcements.content}        IS DISTINCT FROM excluded.content
           OR ${announcements.category}       IS DISTINCT FROM excluded.category
           OR ${announcements.region}         IS DISTINCT FROM excluded.region
           OR ${announcements.targetAudience} IS DISTINCT FROM excluded.target_audience
          THEN NULL
          ELSE ${announcements.embeddingHash}
        END`,
      },
    })
    .returning({
      id: announcements.id,
      isNew: sql<boolean>`(xmax = 0)`,
    });

  const announcementId = row!.id;

  const attachments = raw.attachments ?? [];
  if (attachments.length > 0) {
    await db
      .insert(announcementAttachments)
      .values(
        attachments.map((attachment) => ({
          announcementId,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl,
          mimeType: attachment.mimeType ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [
          announcementAttachments.announcementId,
          announcementAttachments.fileUrl,
        ],
        set: { fileName: sql`excluded.file_name` },
      });
  }

  return { announcementId, isNew: Boolean(row!.isNew) };
}

/**
 * 첨부파일(HWP/PDF) 텍스트 추출.
 * 본문이 첨부에만 있는 공고가 많아 추천 정밀도를 좌우하는 단계다.
 */
export async function parsePendingAttachments(limit = 50): Promise<number> {
  const pending = await db
    .select()
    .from(announcementAttachments)
    .where(eq(announcementAttachments.parseStatus, "PENDING"))
    .orderBy(asc(announcementAttachments.createdAt))
    .limit(limit);

  let parsed = 0;
  for (const attachment of pending) {
    if (await parseAndStore(attachment)) parsed += 1;
  }
  return parsed;
}

export interface AttachmentExtractionResult {
  total: number;
  parsed: number;
  failed: number;
  unsupported: number;
}

/**
 * 공고 한 건의 첨부를 모두 추출한다.
 *
 * 전체 공고를 일괄 처리하지 않는 이유: 파일 하나가 수백 KB 라 700건이면 수백 MB 를
 * 정부 서버에서 내려받게 된다. 실제로 지원할 공고는 극소수이므로,
 * 사용자가 지원서 상세에서 요청할 때만 그 공고 것만 받는다.
 *
 * 이전에 실패했거나 미지원이었던 것도 다시 시도한다 — 파서를 새로 붙였을 수 있다.
 */
export async function extractAttachmentsForAnnouncement(
  announcementId: string,
): Promise<AttachmentExtractionResult & { enrichedFromSource: boolean }> {
  let enrichedFromSource = false;

  // 첨부가 없으면 「관련사이트」 원문에서 가져올 수 있는지 먼저 본다
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(announcementAttachments)
    .where(eq(announcementAttachments.announcementId, announcementId));

  if ((existing?.count ?? 0) === 0) {
    const enriched = await enrichFromSourceUrl(announcementId);
    enrichedFromSource =
      enriched.attachmentsAdded > 0 || enriched.contentImproved;
  }

  const attachments = await db
    .select()
    .from(announcementAttachments)
    .where(eq(announcementAttachments.announcementId, announcementId))
    .orderBy(asc(announcementAttachments.createdAt));

  const result: AttachmentExtractionResult & { enrichedFromSource: boolean } = {
    enrichedFromSource,
    total: attachments.length,
    parsed: 0,
    failed: 0,
    unsupported: 0,
  };

  for (const attachment of attachments) {
    const status = await parseAndStore(attachment);
    if (status === true) result.parsed += 1;
    else if (status === "UNSUPPORTED") result.unsupported += 1;
    else result.failed += 1;
  }

  return result;
}

/**
 * 공고가 「관련사이트」로 기업마당 원문을 가리키면 그쪽에서 본문·첨부를 보강한다.
 *
 * egbiz 는 본문 없이 링크만 걸어 두는 공고가 많다 — 실제 공고문 PDF 는 기업마당에 있다.
 * 첨부 추출을 요청했을 때 첨부가 하나도 없으면 이 경로를 한 번 시도한다.
 */
export async function enrichFromSourceUrl(
  announcementId: string,
): Promise<{ attachmentsAdded: number; contentImproved: boolean }> {
  const [row] = await db
    .select({
      id: announcements.id,
      sourceUrl: announcements.sourceUrl,
      content: announcements.content,
    })
    .from(announcements)
    .where(eq(announcements.id, announcementId));

  if (!row?.sourceUrl) return { attachmentsAdded: 0, contentImproved: false };

  const linked = await fetchBizinfoByUrl(row.sourceUrl);
  if (!linked) return { attachmentsAdded: 0, contentImproved: false };

  const attachments = linked.attachments ?? [];
  if (attachments.length > 0) {
    await db
      .insert(announcementAttachments)
      .values(
        attachments.map((attachment) => ({
          announcementId,
          fileName: attachment.fileName,
          fileUrl: attachment.fileUrl,
          mimeType: attachment.mimeType ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [
          announcementAttachments.announcementId,
          announcementAttachments.fileUrl,
        ],
      });
  }

  // 원문 본문이 더 길면 교체한다 (egbiz 본문은 링크 안내뿐인 경우가 많다)
  const improved = linked.content.length > row.content.length;
  if (improved) {
    await db
      .update(announcements)
      .set({
        content: linked.content,
        summary: truncate(linked.content, 300),
        targetAudience: linked.targetAudience ?? undefined,
        embeddingHash: null,
      })
      .where(eq(announcements.id, announcementId));
  }

  return { attachmentsAdded: attachments.length, contentImproved: improved };
}

/** 첨부 하나를 받아 추출하고 저장한다. 성공이면 true, 아니면 상태 문자열 */
async function parseAndStore(attachment: {
  id: string;
  announcementId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
}): Promise<true | "UNSUPPORTED" | "FAILED"> {
  const result = await parseAttachment({
    fileName: attachment.fileName,
    fileUrl: attachment.fileUrl,
    mimeType: attachment.mimeType,
  });

  await db
    .update(announcementAttachments)
    .set({
      parseStatus: result.status,
      // 목록의 링크 텍스트("다운로드")보다 헤더의 실제 파일명이 정확하다
      fileName: result.fileName ?? attachment.fileName,
      extractedText: result.text ? truncate(result.text, 50_000) : null,
      parseError: result.error ?? null,
    })
    .where(eq(announcementAttachments.id, attachment.id));

  if (result.status !== "PARSED") {
    return result.status === "UNSUPPORTED" ? "UNSUPPORTED" : "FAILED";
  }

  // 본문이 늘었으니 다음 임베딩 대상이 되도록 해시를 무효화한다
  await db
    .update(announcements)
    .set({ embeddingHash: null })
    .where(eq(announcements.id, attachment.announcementId));

  return true;
}

/**
 * 임베딩 대상 조건. `getEmbeddingStatus()` 의 pending 계산과 **반드시 같아야** 한다.
 * (다르면 화면에 "미임베딩 121건"이라 떠 놓고 실제로는 96건만 처리하는 일이 생긴다)
 *
 * 돈이 나가는 호출이라 "추천에 절대 안 쓰일 공고"는 처음부터 제외한다:
 *  - 이미 마감된 공고 — 추천은 모집중만 보여준다
 *  - seed 샘플 — 실제 공고가 아니다
 */
export function embeddingTargetCondition() {
  return and(
    isNull(announcements.embeddingHash),
    eq(announcements.isSample, false),
    or(isNull(announcements.endDate), gte(announcements.endDate, new Date())),
  )!;
}

/** 한 번에 임베딩하고 바로 저장하는 단위 */
const EMBED_CHUNK_SIZE = 64;

/**
 * embeddingHash 가 비었거나 원문이 바뀐 공고만 다시 임베딩한다.
 * (같은 공고를 매 배치마다 재임베딩하면 API 비용이 그대로 낭비된다)
 *
 * 청크 단위로 "생성 → 즉시 저장"을 반복한다. 전부 만들고 한 번에 저장하면
 * 뒷 청크가 실패했을 때 이미 결제한 앞 청크까지 통째로 버리게 된다.
 */
export async function embedPendingAnnouncements(limit = 200): Promise<number> {
  if (!isAiEnabled()) return 0;

  return withAdvisoryLock(EMBED_LOCK_KEY, () => embedPendingInner(limit), 0);
}

export async function embedPendingWithoutLock(limit: number): Promise<number> {
  return embedPendingInner(limit);
}

async function embedPendingInner(limit: number): Promise<number> {
  const candidates = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      content: announcements.content,
      category: announcements.category,
      region: announcements.region,
      targetAudience: announcements.targetAudience,
    })
    .from(announcements)
    .where(embeddingTargetCondition())
    // 마감 임박한 것부터 — 도중에 끊겨도 급한 공고는 임베딩돼 있다
    .orderBy(sql`${announcements.endDate} ASC NULLS LAST`)
    .limit(limit);

  if (candidates.length === 0) return 0;

  // 파싱이 끝난 첨부 텍스트를 한 번에 읽어 공고별로 묶는다
  const parsedAttachments = await db
    .select({
      announcementId: announcementAttachments.announcementId,
      extractedText: announcementAttachments.extractedText,
    })
    .from(announcementAttachments)
    .where(
      and(
        eq(announcementAttachments.parseStatus, "PARSED"),
        inArray(
          announcementAttachments.announcementId,
          candidates.map((candidate) => candidate.id),
        ),
      ),
    );

  const textsByAnnouncement = new Map<string, string[]>();
  for (const attachment of parsedAttachments) {
    if (!attachment.extractedText) continue;
    const list = textsByAnnouncement.get(attachment.announcementId) ?? [];
    list.push(attachment.extractedText);
    textsByAnnouncement.set(attachment.announcementId, list);
  }

  const sources = candidates.map((candidate) =>
    buildEmbeddingSource({
      title: candidate.title,
      category: candidate.category,
      region: candidate.region,
      targetAudience: candidate.targetAudience,
      content: candidate.content,
      attachmentTexts: textsByAnnouncement.get(candidate.id) ?? [],
    }),
  );

  let embedded = 0;
  for (let start = 0; start < candidates.length; start += EMBED_CHUNK_SIZE) {
    const chunk = candidates.slice(start, start + EMBED_CHUNK_SIZE);
    const chunkSources = sources.slice(start, start + EMBED_CHUNK_SIZE);

    const vectors = await createEmbeddings(chunkSources);

    // 만든 즉시 저장한다 — 다음 청크가 실패해도 여기까지는 남는다
    for (const [index, candidate] of chunk.entries()) {
      const vector = vectors[index];
      const source = chunkSources[index];
      if (!vector || !source) continue;

      await db
        .update(announcements)
        .set({ embedding: vector, embeddingHash: contentHash(source) })
        .where(eq(announcements.id, candidate.id));
      embedded += 1;
    }
  }

  return embedded;
}

export async function ingestSource(
  adapter: AnnouncementSourceAdapter,
  options: IngestOptions = {},
): Promise<IngestionResult> {
  // dry-run 은 DB 를 건드리지 않으므로 잠글 필요가 없다
  if (options.dryRun) return ingestSourceInner(adapter, options);

  return withAdvisoryLock(
    INGEST_LOCK_KEY,
    () => ingestSourceInner(adapter, options),
    {
      source: adapter.source,
      fetched: 0,
      created: 0,
      updated: 0,
      embedded: 0,
      skippedReason: "다른 수집이 이미 실행 중이라 건너뛰었습니다.",
    },
  );
}

async function ingestSourceInner(
  adapter: AnnouncementSourceAdapter,
  options: IngestOptions = {},
): Promise<IngestionResult> {
  const result: IngestionResult = {
    source: adapter.source,
    fetched: 0,
    created: 0,
    updated: 0,
    embedded: 0,
  };

  if (!adapter.isConfigured()) {
    result.skippedReason = `${adapter.label} 설정이 없습니다 (.env.local 확인)`;
    return result;
  }

  const run = options.dryRun
    ? null
    : (
        await db
          .insert(ingestionRuns)
          .values({ source: adapter.source })
          .returning({ id: ingestionRuns.id })
      )[0];

  try {
    // --full 은 멈춤 신호를 끄고 maxPages 까지 훑는다 (백필)
    const knownExternalIds = options.full
      ? undefined
      : await loadKnownExternalIds(adapter.source);

    const raws = await adapter.fetchAnnouncements({
      ...options,
      knownExternalIds,
    });
    result.fetched = raws.length;

    if (options.dryRun) {
      console.info(
        `[ingest:${adapter.source}] dry-run — ${raws.length}건 수집`,
        raws.slice(0, 3),
      );
      return result;
    }

    for (const raw of raws) {
      const { isNew } = await upsertAnnouncement(raw);
      if (isNew) result.created += 1;
      else result.updated += 1;
    }

    if (!options.skipAttachments) {
      await parsePendingAttachments();
    }

    if (!options.skipEmbedding) {
      result.embedded = await embedPendingAnnouncements();
    }

    if (run) {
      await db
        .update(ingestionRuns)
        .set({
          status: "SUCCESS",
          fetchedCount: result.fetched,
          createdCount: result.created,
          updatedCount: result.updated,
          embeddedCount: result.embedded,
          finishedAt: new Date(),
        })
        .where(eq(ingestionRuns.id, run.id));
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    if (run) {
      await db
        .update(ingestionRuns)
        .set({
          status: "FAILED",
          error: truncate(result.error, 2000),
          finishedAt: new Date(),
        })
        .where(eq(ingestionRuns.id, run.id));
    }
  }

  return result;
}

export async function ingestAll(
  options: IngestOptions = {},
): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];
  for (const adapter of adapters) {
    results.push(await ingestSource(adapter, options));
  }
  return results;
}

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
import { bizinfoAdapter } from "./sources/bizinfo";
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
}

/**
 * 같은 작업이 동시에 두 번 도는 것을 막는다 (cron 과 화면 버튼이 겹치는 경우).
 * 결과 자체는 upsert 라 안전하지만, 유료 API 를 두 번 호출하는 게 문제다.
 *
 * 세션 단위 advisory lock 이라 풀에서 전용 커넥션을 하나 잡아 쓴다.
 * 수집과 임베딩은 키가 달라 서로를 막지 않는다(수집이 내부에서 임베딩을 호출한다).
 */
const INGEST_LOCK_KEY = 811_001;
const EMBED_LOCK_KEY = 811_002;

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
    const result = await parseAttachment({
      fileName: attachment.fileName,
      fileUrl: attachment.fileUrl,
      mimeType: attachment.mimeType,
    });

    await db
      .update(announcementAttachments)
      .set({
        parseStatus: result.status,
        extractedText: result.text
          ? truncate(normalizeWhitespace(result.text), 50_000)
          : null,
        parseError: result.error ?? null,
      })
      .where(eq(announcementAttachments.id, attachment.id));

    if (result.status === "PARSED") {
      parsed += 1;
      // 본문이 바뀌었으니 다음 임베딩 대상이 되도록 해시를 무효화한다
      await db
        .update(announcements)
        .set({ embeddingHash: null })
        .where(eq(announcements.id, attachment.announcementId));
    }
  }

  return parsed;
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
    const raws = await adapter.fetchAnnouncements(options);
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

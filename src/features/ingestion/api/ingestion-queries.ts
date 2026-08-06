import { count, desc, eq, isNull, sql } from "drizzle-orm";

import {
  announcementAttachments,
  announcements,
  db,
  ingestionRuns,
  type AnnouncementSource,
} from "@/db";

import { isAiEnabled } from "@/lib/env";

import {
  adapters,
  embeddingTargetCondition,
  isEmbeddingRunning,
  reconcileStaleRuns,
} from "../ingest";

export { isIngestionRunning } from "../ingest";

export interface SourceStatus {
  source: AnnouncementSource;
  label: string;
  configured: boolean;
  /** 이 소스가 요구하는 휘발성 키 이름 (없으면 null) */
  requiresKey: "dataGoKr" | "openai" | null;
  announcementCount: number;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
}

export async function getSourceStatuses(): Promise<SourceStatus[]> {
  const [counts, lastRuns] = await Promise.all([
    db
      .select({ source: announcements.source, total: count() })
      .from(announcements)
      .groupBy(announcements.source),
    // 소스별 최신 실행 1건씩
    db
      .selectDistinctOn([ingestionRuns.source], {
        source: ingestionRuns.source,
        status: ingestionRuns.status,
        error: ingestionRuns.error,
        startedAt: ingestionRuns.startedAt,
        finishedAt: ingestionRuns.finishedAt,
      })
      .from(ingestionRuns)
      .orderBy(ingestionRuns.source, desc(ingestionRuns.startedAt)),
  ]);

  return adapters.map((adapter) => {
    const countRow = counts.find((item) => item.source === adapter.source);
    const run = lastRuns.find((item) => item.source === adapter.source);

    return {
      source: adapter.source,
      label: adapter.label,
      configured: adapter.isConfigured(),
      requiresKey: adapter.requiresKey ?? null,
      announcementCount: countRow?.total ?? 0,
      lastRunAt: run?.finishedAt ?? run?.startedAt ?? null,
      lastRunStatus: run?.status ?? null,
      lastRunError: run?.error ?? null,
    };
  });
}

export async function listIngestionRuns(limit = 15) {
  // 서버 재시작 등으로 죽은 RUNNING 기록을 먼저 정리한다 (잠금이 비어 있으면 죽은 것)
  await reconcileStaleRuns();

  return db
    .select()
    .from(ingestionRuns)
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(limit);
}

export type IngestionRunItem = Awaited<
  ReturnType<typeof listIngestionRuns>
>[number];

export interface EmbeddingStatus {
  /** 서버 .env 에 OpenAI 키가 있는지 (브라우저 입력 키는 클라이언트가 따로 본다) */
  aiEnabled: boolean;
  total: number;
  /** 마감·샘플이라 임베딩 대상에서 뺀 건수 (비용 절약분) */
  excluded: number;
  /** 지금 백그라운드에서 임베딩이 돌고 있는지 */
  running: boolean;
  embedded: number;
  pending: number;
  attachmentsPending: number;
}

export async function getEmbeddingStatus(): Promise<EmbeddingStatus> {
  const [[totals], [attachments], running] = await Promise.all([
    db
      .select({
        total: count(),
        embedded: sql<number>`count(*) FILTER (WHERE ${announcements.embedding} IS NOT NULL)::int`,
        // 임베딩 대기 = 해시가 비어 있는 것 (본문이 바뀌면 해시를 비운다)
        // ingest.ts 의 embeddingTargetCondition() 을 그대로 써서 화면 숫자와 실제 처리량을 맞춘다
        pending: sql<number>`count(*) FILTER (WHERE ${embeddingTargetCondition()})::int`,
        // 마감·샘플이라 일부러 제외한 건수 — 화면에서 "왜 121이 아니지"를 설명한다
        excluded: sql<number>`count(*) FILTER (WHERE ${isNull(announcements.embeddingHash)} AND NOT (${embeddingTargetCondition()}))::int`,
      })
      .from(announcements),
    db
      .select({ total: count() })
      .from(announcementAttachments)
      .where(eq(announcementAttachments.parseStatus, "PENDING")),
    isEmbeddingRunning(),
  ]);

  return {
    aiEnabled: isAiEnabled(),
    total: totals?.total ?? 0,
    embedded: totals?.embedded ?? 0,
    pending: totals?.pending ?? 0,
    excluded: totals?.excluded ?? 0,
    running,
    attachmentsPending: attachments?.total ?? 0,
  };
}

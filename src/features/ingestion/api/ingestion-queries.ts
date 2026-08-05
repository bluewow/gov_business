import { count, desc, eq, isNull, sql } from "drizzle-orm";

import {
  announcementAttachments,
  announcements,
  db,
  ingestionRuns,
  type AnnouncementSource,
} from "@/db";

import { adapters } from "../ingest";

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
  total: number;
  embedded: number;
  pending: number;
  attachmentsPending: number;
}

export async function getEmbeddingStatus(): Promise<EmbeddingStatus> {
  const [[totals], [attachments]] = await Promise.all([
    db
      .select({
        total: count(),
        embedded: sql<number>`count(*) FILTER (WHERE ${announcements.embedding} IS NOT NULL)::int`,
        // 임베딩 대기 = 해시가 비어 있는 것 (본문이 바뀌면 해시를 비운다)
        pending: sql<number>`count(*) FILTER (WHERE ${isNull(announcements.embeddingHash)})::int`,
      })
      .from(announcements),
    db
      .select({ total: count() })
      .from(announcementAttachments)
      .where(eq(announcementAttachments.parseStatus, "PENDING")),
  ]);

  return {
    total: totals?.total ?? 0,
    embedded: totals?.embedded ?? 0,
    pending: totals?.pending ?? 0,
    attachmentsPending: attachments?.total ?? 0,
  };
}

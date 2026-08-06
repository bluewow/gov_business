import { desc, sql } from "drizzle-orm";

import { aiUsage, db } from "@/db";
import type { aiFeatureEnum } from "@/db/schema";

export type AiFeature = (typeof aiFeatureEnum.enumValues)[number];

/** OpenAI 응답의 usage 필드 (채팅·임베딩 공통 부분만) */
export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * 호출 1건의 토큰 사용량을 남긴다.
 *
 * **절대 throw 하지 않는다.** 사용량 기록이 실패했다고 검토·초안이 실패하면 본말전도다.
 * usage 가 없는 응답(스트리밍 등)도 조용히 넘어간다.
 */
export async function recordAiUsage(input: {
  feature: AiFeature;
  model: string;
  usage: OpenAiUsage | null | undefined;
  /** 이 호출이 처리한 건수 (임베딩 배치용) */
  items?: number;
}): Promise<void> {
  if (!input.usage) return;

  const promptTokens = input.usage.prompt_tokens ?? 0;
  const completionTokens = input.usage.completion_tokens ?? 0;

  try {
    await db.insert(aiUsage).values({
      feature: input.feature,
      model: input.model,
      promptTokens,
      completionTokens,
      totalTokens: input.usage.total_tokens ?? promptTokens + completionTokens,
      items: input.items ?? 1,
    });
  } catch (error) {
    console.warn("[ai-usage] 사용량 기록 실패", error);
  }
}

export interface AiUsageRow {
  feature: AiFeature;
  calls: number;
  items: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiUsageSummary {
  rows: AiUsageRow[];
  total: AiUsageRow | null;
  lastUsedAt: Date | null;
}

/** 기능별 누적 사용량 (전체 기간) */
export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  const rows = await db
    .select({
      feature: aiUsage.feature,
      calls: sql<number>`count(*)::int`,
      items: sql<number>`sum(${aiUsage.items})::int`,
      promptTokens: sql<number>`sum(${aiUsage.promptTokens})::int`,
      completionTokens: sql<number>`sum(${aiUsage.completionTokens})::int`,
      totalTokens: sql<number>`sum(${aiUsage.totalTokens})::int`,
    })
    .from(aiUsage)
    .groupBy(aiUsage.feature)
    .orderBy(desc(sql`sum(${aiUsage.totalTokens})`));

  const [latest] = await db
    .select({ createdAt: aiUsage.createdAt })
    .from(aiUsage)
    .orderBy(desc(aiUsage.createdAt))
    .limit(1);

  if (rows.length === 0) {
    return { rows: [], total: null, lastUsedAt: null };
  }

  const total = rows.reduce<AiUsageRow>(
    (sum, row) => ({
      feature: sum.feature,
      calls: sum.calls + row.calls,
      items: sum.items + row.items,
      promptTokens: sum.promptTokens + row.promptTokens,
      completionTokens: sum.completionTokens + row.completionTokens,
      totalTokens: sum.totalTokens + row.totalTokens,
    }),
    {
      feature: "EMBEDDING",
      calls: 0,
      items: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  );

  return { rows, total, lastUsedAt: latest?.createdAt ?? null };
}

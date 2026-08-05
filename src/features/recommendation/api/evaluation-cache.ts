import { and, eq, inArray, sql } from "drizzle-orm";

import { db, llmEvaluations } from "@/db";
import { contentHash } from "@/lib/text";

import type { LlmEvaluation, MatchedAnnouncement } from "../types";

/**
 * LLM 정밀 평가 캐시.
 *
 * 사업 설명도 공고 내용도 그대로인데 다시 물어보면 같은 답에 돈만 나간다.
 * 키워드만 바꿔 가며 여러 번 검색하는 게 이 화면의 기본 사용 패턴이라 재호출이 잦다.
 *
 * 무효화 기준: 사업 설명 해시 · 공고 원문 해시 · 모델명. 하나라도 다르면 다시 부른다.
 */

/** 공고가 아직 임베딩되지 않았을 수도 있으므로 원문으로도 해시를 만들 수 있게 한다 */
export function announcementHashOf(announcement: MatchedAnnouncement): string {
  return (
    announcement.embeddingHash ??
    contentHash(
      `${announcement.title}\n${announcement.summary ?? announcement.content}`,
    )
  );
}

export function businessHashOf(description: string): string {
  return contentHash(description);
}

export async function getCachedEvaluations(input: {
  userBusinessId: string;
  businessHash: string;
  model: string;
  announcements: MatchedAnnouncement[];
}): Promise<Map<string, LlmEvaluation>> {
  const cached = new Map<string, LlmEvaluation>();
  if (input.announcements.length === 0) return cached;

  const rows = await db
    .select({
      announcementId: llmEvaluations.announcementId,
      score: llmEvaluations.score,
      reason: llmEvaluations.reason,
      announcementHash: llmEvaluations.announcementHash,
    })
    .from(llmEvaluations)
    .where(
      and(
        eq(llmEvaluations.userBusinessId, input.userBusinessId),
        eq(llmEvaluations.businessHash, input.businessHash),
        eq(llmEvaluations.model, input.model),
        inArray(
          llmEvaluations.announcementId,
          input.announcements.map((item) => item.id),
        ),
      ),
    );

  const expectedHash = new Map(
    input.announcements.map((item) => [item.id, announcementHashOf(item)]),
  );

  for (const row of rows) {
    // 공고 내용이 바뀌었으면 캐시를 쓰지 않는다
    if (expectedHash.get(row.announcementId) !== row.announcementHash) continue;
    cached.set(row.announcementId, { score: row.score, reason: row.reason });
  }

  return cached;
}

export async function saveEvaluations(input: {
  userBusinessId: string;
  businessHash: string;
  model: string;
  entries: {
    announcement: MatchedAnnouncement;
    evaluation: LlmEvaluation;
  }[];
}): Promise<void> {
  if (input.entries.length === 0) return;

  await db
    .insert(llmEvaluations)
    .values(
      input.entries.map(({ announcement, evaluation }) => ({
        userBusinessId: input.userBusinessId,
        announcementId: announcement.id,
        score: evaluation.score,
        reason: evaluation.reason,
        businessHash: input.businessHash,
        announcementHash: announcementHashOf(announcement),
        model: input.model,
      })),
    )
    .onConflictDoUpdate({
      target: [llmEvaluations.userBusinessId, llmEvaluations.announcementId],
      set: {
        score: sqlExcluded("score"),
        reason: sqlExcluded("reason"),
        businessHash: sqlExcluded("business_hash"),
        announcementHash: sqlExcluded("announcement_hash"),
        model: sqlExcluded("model"),
        updatedAt: new Date(),
      },
    });
}

/** ON CONFLICT 에서 새로 들어온 값을 가리킨다 */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

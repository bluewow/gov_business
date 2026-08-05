import { and, desc, gte, isNull, or, type SQL } from "drizzle-orm";

import { announcements, db } from "@/db";

import { extractKeywords, normalizeKeywords } from "../keywords";
import type { MatchedAnnouncement, MatchFilter } from "../types";
import {
  candidateLimit,
  findMatchedKeywords,
  keywordCondition,
  rankByKeywords,
} from "./keyword-filter";

/**
 * OPENAI_API_KEY 가 없을 때의 폴백 검색.
 * 임베딩 없이 부분일치로만 찾으므로 정밀도는 낮다 — 개발 편의용이다.
 *
 * 사용자가 키워드를 넣었으면 그것으로, 비웠으면 사업 설명에서 뽑은 키워드로 찾는다.
 */
export async function keywordSearchAnnouncements(
  description: string,
  filter: MatchFilter = {},
): Promise<MatchedAnnouncement[]> {
  const { limit = 10 } = filter;

  const requested = normalizeKeywords(filter.keywords);
  const keywords =
    requested.length > 0 ? requested : extractKeywords(description);
  // 설명에서 뽑은 키워드를 "모두 포함" 으로 걸면 결과가 거의 남지 않는다
  const mode = requested.length > 0 ? (filter.keywordMode ?? "any") : "any";

  const conditions: SQL[] = [];

  const keywordSql = keywordCondition(keywords, mode);
  if (keywordSql) conditions.push(keywordSql);

  if (filter.onlyOpen ?? true) {
    conditions.push(
      or(
        isNull(announcements.endDate),
        gte(announcements.endDate, new Date()),
      )!,
    );
  }

  const rows = await db
    .select({
      id: announcements.id,
      source: announcements.source,
      title: announcements.title,
      summary: announcements.summary,
      content: announcements.content,
      url: announcements.url,
      category: announcements.category,
      region: announcements.region,
      targetAudience: announcements.targetAudience,
      agency: announcements.agency,
      startDate: announcements.startDate,
      endDate: announcements.endDate,
      isSample: announcements.isSample,
    })
    .from(announcements)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(announcements.createdAt))
    .limit(candidateLimit(limit, keywords.length));

  // 유사도 개념이 없으므로 0 으로 채우고 mode 로 구분한다 — 순서는 키워드 적중률이 정한다
  const matches = rows.map((row) => ({
    ...row,
    similarity: 0,
    matchedKeywords: findMatchedKeywords(row, keywords),
  }));

  return rankByKeywords(matches, keywords.length, limit);
}

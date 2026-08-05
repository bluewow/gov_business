import {
  and,
  cosineDistance,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { announcements, db, userBusinesses } from "@/db";

import { normalizeKeywords } from "../keywords";
import type { MatchedAnnouncement, MatchFilter } from "../types";
import {
  candidateLimit,
  findMatchedKeywords,
  keywordCondition,
  rankByKeywords,
} from "./keyword-filter";

/** 1차 필터링 — 키워드/모집중 여부 */
function buildConditions(filter: MatchFilter, keywords: string[]): SQL[] {
  const conditions: SQL[] = [];

  const keywordSql = keywordCondition(keywords, filter.keywordMode ?? "any");
  if (keywordSql) conditions.push(keywordSql);

  if (filter.onlyOpen ?? true) {
    conditions.push(
      or(
        isNull(announcements.endDate),
        gte(announcements.endDate, new Date()),
      )!,
    );
  }

  return conditions;
}

const selection = {
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
  embeddingHash: announcements.embeddingHash,
};

/**
 * 1차 키워드 필터링 + 2차 코사인 유사도 검색.
 *
 * `similarity >= threshold` 대신 `distance <= 1 - threshold` 로 거르고 distance 오름차순으로
 * 정렬한다. `1 - distance` 로 감싸면 HNSW 인덱스를 타지 못하기 때문이다.
 * 키워드가 있으면 후보를 넉넉히 받아 키워드 적중률까지 반영해 다시 줄인다.
 */
export async function matchAnnouncements(
  queryEmbedding: number[],
  filter: MatchFilter = {},
): Promise<MatchedAnnouncement[]> {
  const { threshold = 0.3, limit = 10 } = filter;
  const keywords = normalizeKeywords(filter.keywords);

  const distance = cosineDistance(announcements.embedding, queryEmbedding);

  const rows = await db
    .select({
      ...selection,
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(announcements)
    .where(
      and(
        isNotNull(announcements.embedding),
        lte(distance, 1 - threshold),
        ...buildConditions(filter, keywords),
      ),
    )
    .orderBy(distance)
    .limit(candidateLimit(limit, keywords.length));

  const matches = rows.map((row) => ({
    ...row,
    similarity: Number(row.similarity),
    matchedKeywords: findMatchedKeywords(row, keywords),
  }));

  return rankByKeywords(matches, keywords.length, limit);
}

/**
 * 저장된 사업 프로필의 임베딩을 그대로 사용한다.
 * 매 조회마다 사업 설명을 재임베딩하지 않으므로 OpenAI 호출이 0회다.
 * 프로필에 임베딩이 없으면(키 미설정 또는 저장 전) 빈 배열을 돌려준다.
 */
export async function matchAnnouncementsForBusiness(
  businessId: string,
  filter: MatchFilter = {},
): Promise<MatchedAnnouncement[]> {
  const business = await db.query.userBusinesses.findFirst({
    where: eq(userBusinesses.id, businessId),
    columns: { embedding: true },
  });

  if (!business?.embedding) return [];

  return matchAnnouncements(business.embedding, filter);
}

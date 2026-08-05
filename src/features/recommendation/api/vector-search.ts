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
import { dedupeAnnouncements } from "./dedupe";
import { findMatchedKeywords, keywordCondition } from "./keyword-filter";

/** 유사도 하한. 후보를 자르는 건 상위 N 정렬이고, 이 값은 쓰레기 차단용이다. */
const DEFAULT_THRESHOLD = 0.15;

/** 각 갈래에서 넉넉히 받아 두는 배수 — 중복을 접고 나서도 limit 을 채우기 위함 */
const CANDIDATE_MULTIPLIER = 3;
const MAX_CANDIDATES = 60;

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

function openCondition(filter: MatchFilter): SQL | undefined {
  if (!(filter.onlyOpen ?? true)) return undefined;
  return or(
    isNull(announcements.endDate),
    gte(announcements.endDate, new Date()),
  );
}

/**
 * 코사인 유사도 상위 N 건.
 *
 * `similarity >= threshold` 대신 `distance <= 1 - threshold` 로 거르고 distance 오름차순으로
 * 정렬한다. `1 - distance` 로 감싸면 HNSW 인덱스를 타지 못하기 때문이다.
 */
async function searchByVector(
  queryEmbedding: number[],
  filter: MatchFilter,
  keywords: string[],
  options: { useKeywordFilter: boolean; limit: number },
): Promise<MatchedAnnouncement[]> {
  const { threshold = DEFAULT_THRESHOLD } = filter;
  const distance = cosineDistance(announcements.embedding, queryEmbedding);

  const rows = await db
    .select({ ...selection, similarity: sql<number>`1 - (${distance})` })
    .from(announcements)
    .where(
      and(
        isNotNull(announcements.embedding),
        lte(distance, 1 - threshold),
        openCondition(filter),
        options.useKeywordFilter
          ? keywordCondition(keywords, filter.keywordMode ?? "any")
          : undefined,
      ),
    )
    .orderBy(distance)
    .limit(options.limit);

  return rows.map((row) => {
    const matchedKeywords = findMatchedKeywords(row, keywords);
    return {
      ...row,
      similarity: Number(row.similarity),
      matchedKeywords,
      matchedBy: matchedKeywords.length > 0 ? "keyword" : "semantic",
      duplicateSources: [],
    } satisfies MatchedAnnouncement;
  });
}

/**
 * 두 후보군을 번갈아 뽑아 합친다.
 *
 * 키워드 갈래만 쓰면 어휘가 다른 좋은 공고를 통째로 놓치고(실제로 그래서 놓쳤다),
 * 의미 갈래만 쓰면 사용자가 지정한 방향이 무시된다. 점수로 한 줄 세우면 한쪽이
 * 다른 쪽을 밀어내므로, 순번을 번갈아 주어 양쪽 다 자리를 갖게 한다.
 */
function interleave(
  lexical: MatchedAnnouncement[],
  semantic: MatchedAnnouncement[],
  limit: number,
): MatchedAnnouncement[] {
  const merged: MatchedAnnouncement[] = [];
  const taken = new Set<string>();

  for (let index = 0; merged.length < limit; index += 1) {
    const next = [lexical[index], semantic[index]].filter(
      (item) => item !== undefined,
    );
    if (next.length === 0) break;

    for (const item of next) {
      if (taken.has(item.id)) continue;
      taken.add(item.id);
      merged.push(item);
      if (merged.length >= limit) break;
    }
  }

  return merged;
}

/**
 * 하이브리드 검색 — 키워드는 게이트가 아니라 힌트다.
 *
 * 키워드를 SQL 하드 필터로만 쓰면, 문자열이 하나도 안 걸리는 공고는 벡터 검색이
 * 보지도 못한 채 잘려 나간다. 어휘가 달라도 의미로 찾으라고 임베딩을 쓰는 건데
 * 그 앞에 문자열 게이트를 세우는 셈이라 자기모순이다.
 *
 * 그래서 두 갈래를 각각 뽑아 합친다.
 *   lexical  — 키워드가 걸린 공고 중 유사도 상위 (사용자가 지정한 방향)
 *   semantic — 키워드를 무시한 유사도 상위 (어휘가 달라도 가까운 공고)
 */
export async function matchAnnouncements(
  queryEmbedding: number[],
  filter: MatchFilter = {},
): Promise<MatchedAnnouncement[]> {
  const { limit = 10 } = filter;
  const keywords = normalizeKeywords(filter.keywords);
  const candidates = Math.min(limit * CANDIDATE_MULTIPLIER, MAX_CANDIDATES);

  if (keywords.length === 0) {
    const semantic = await searchByVector(queryEmbedding, filter, keywords, {
      useKeywordFilter: false,
      limit: candidates,
    });
    return dedupeAnnouncements(semantic).slice(0, limit);
  }

  const [lexical, semantic] = await Promise.all([
    searchByVector(queryEmbedding, filter, keywords, {
      useKeywordFilter: true,
      limit: candidates,
    }),
    searchByVector(queryEmbedding, filter, keywords, {
      useKeywordFilter: false,
      limit: candidates,
    }),
  ]);

  // 중복은 합치기 전에 접는다 — 같은 공고가 양쪽 갈래에서 한 칸씩 먹지 않도록
  return interleave(
    dedupeAnnouncements(lexical),
    dedupeAnnouncements(semantic),
    limit,
  );
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

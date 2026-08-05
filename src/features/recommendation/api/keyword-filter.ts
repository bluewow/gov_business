import { and, ilike, or, type SQL } from "drizzle-orm";

import { announcements } from "@/db";

import type { KeywordMode, MatchedAnnouncement } from "../types";

/**
 * 키워드를 찾을 컬럼. 지역·분야·지원대상·기관이 모두 들어 있으므로
 * 「경기」·「창업」 같은 값도 별도 필터 없이 키워드 하나로 걸린다.
 */
const SEARCHABLE_COLUMNS = [
  announcements.title,
  announcements.summary,
  announcements.content,
  announcements.category,
  announcements.region,
  announcements.targetAudience,
  announcements.agency,
];

/** LIKE 와일드카드(%, _)와 이스케이프 문자를 리터럴로 취급한다 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 키워드 1차 필터.
 * `any` 는 하나라도 걸리면 통과(넓게), `all` 은 전부 걸려야 통과(좁게).
 * 키워드가 없으면 undefined 를 돌려주고, 호출부는 조건을 걸지 않는다.
 */
export function keywordCondition(
  keywords: string[],
  mode: KeywordMode = "any",
): SQL | undefined {
  if (keywords.length === 0) return undefined;

  const perKeyword = keywords.map((keyword) =>
    or(
      ...SEARCHABLE_COLUMNS.map((column) =>
        ilike(column, `%${escapeLike(keyword)}%`),
      ),
    )!,
  );

  return mode === "all" ? and(...perKeyword)! : or(...perKeyword)!;
}

type SearchableRow = Pick<
  MatchedAnnouncement,
  | "title"
  | "summary"
  | "content"
  | "category"
  | "region"
  | "targetAudience"
  | "agency"
>;

/** 어떤 키워드가 실제로 걸렸는지 — 카드에 표시하고 정렬 가중치로도 쓴다 */
export function findMatchedKeywords(
  row: SearchableRow,
  keywords: string[],
): string[] {
  if (keywords.length === 0) return [];

  const haystack = [
    row.title,
    row.summary,
    row.content,
    row.category,
    row.region,
    row.targetAudience,
    row.agency,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()));
}

/** 후보를 넉넉히 받아 두는 배수와 상한 */
const CANDIDATE_MULTIPLIER = 3;
const MAX_CANDIDATES = 60;

/**
 * DB 에서 가져올 후보 개수.
 * 유사도 상위 N 건만 보면 키워드를 많이 맞춘 공고가 잘려 나가므로,
 * 키워드가 있을 때는 넉넉히 받아 아래 rankByKeywords 로 다시 줄인다.
 */
export function candidateLimit(limit: number, keywordCount: number): number {
  if (keywordCount === 0) return limit;
  return Math.min(limit * CANDIDATE_MULTIPLIER, MAX_CANDIDATES);
}

/** 키워드 적중률이 순위를 뒤집지 않도록 작게 잡은 가중치 */
const KEYWORD_WEIGHT = 0.05;

/**
 * 유사도를 주(主)로, 키워드 적중률을 보조로 정렬한다.
 * 키워드 검색 폴백은 similarity 가 0 이라 사실상 적중률 순이 되고,
 * 동점은 안정 정렬이라 DB 정렬(최신순)이 그대로 유지된다.
 */
export function rankByKeywords<
  T extends { similarity: number; matchedKeywords: string[] },
>(rows: T[], keywordCount: number, limit: number): T[] {
  if (keywordCount === 0) return rows.slice(0, limit);

  const score = (row: T) =>
    row.similarity +
    KEYWORD_WEIGHT * (row.matchedKeywords.length / keywordCount);

  return [...rows].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

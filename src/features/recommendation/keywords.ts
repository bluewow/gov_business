/**
 * 키워드 정규화·추출 — 서버(SQL 조건 생성)와 클라이언트(칩 입력) 양쪽에서 쓴다.
 * DB 를 import 하지 않으므로 클라이언트 컴포넌트에서 그대로 가져다 쓸 수 있다.
 */

/** 한 번에 거는 키워드 상한 — 조건이 (키워드 × 검색 컬럼) 수만큼 늘어난다 */
export const MAX_KEYWORDS = 8;

/** 쉼표·줄바꿈으로 구분된 입력을 키워드 배열로 */
export function parseKeywordInput(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

/** 공백 정리 + 대소문자 무시 중복 제거 + 개수 제한 */
export function normalizeKeywords(
  keywords: readonly string[] | null | undefined,
  limit = MAX_KEYWORDS,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of keywords ?? []) {
    const keyword = raw.trim().replace(/\s+/g, " ");
    if (!keyword) continue;

    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(keyword);
    if (result.length >= limit) break;
  }

  return result;
}

/** 대소문자를 무시하고 이미 담긴 키워드인지 확인 */
export function hasKeyword(
  keywords: readonly string[],
  keyword: string,
): boolean {
  const key = keyword.trim().toLowerCase();
  return keywords.some((existing) => existing.toLowerCase() === key);
}

/** 조사·불용어를 걷어내고 2글자 이상 토큰만 남긴다 */
const STOP_WORDS = new Set([
  "그리고",
  "하는",
  "위한",
  "관련",
  "사업",
  "지원",
  "서비스",
  "기반",
  "통해",
  "우리",
  "저희",
]);

/** 사업 설명에서 키워드 후보를 뽑는다 — 추천 키워드 칩과 키워드 검색 폴백에 쓴다 */
export function extractKeywords(text: string, limit = 8): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

  const frequency = new Map<string, number>();
  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

import type { MatchedAnnouncement } from "../types";

/**
 * 같은 공고가 소스별로 중복 수집된다 (기업마당 공고가 egbiz 에도 실리는 식).
 * 실측 기준 전체의 약 19% 가 중복이라, 그대로 두면 추천 10칸 중 여러 칸을
 * 같은 공고가 차지한다.
 *
 * `(제목, 마감일)` 이 같으면 같은 공고로 본다 — 원본 시스템이 다르니 id 는 못 쓰고,
 * 제목만으로 묶으면 해마다 같은 이름으로 나오는 공고까지 뭉쳐 버린다.
 */
function dedupeKey(item: MatchedAnnouncement): string {
  const title = item.title.replace(/\s+/g, " ").trim().toLowerCase();
  const deadline = item.endDate ? item.endDate.toISOString().slice(0, 10) : "-";
  return `${title}|${deadline}`;
}

/**
 * 앞에 온 것(= 순위가 높은 것)을 남기고 뒤의 중복은 접는다.
 * 접힌 공고의 출처는 `duplicateSources` 에 모아 화면에서 "다른 곳에도 있음" 을 보여준다.
 */
export function dedupeAnnouncements<T extends MatchedAnnouncement>(
  items: T[],
): T[] {
  const byKey = new Map<string, T>();

  for (const item of items) {
    const key = dedupeKey(item);
    const kept = byKey.get(key);

    if (!kept) {
      byKey.set(key, { ...item, duplicateSources: [] });
      continue;
    }

    if (
      kept.source !== item.source &&
      !kept.duplicateSources.includes(item.source)
    ) {
      kept.duplicateSources.push(item.source);
    }
  }

  return [...byKey.values()];
}

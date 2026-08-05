/** yyyy-MM-dd. 서버/클라이언트 타임존 차이로 인한 hydration 불일치를 피하려고 ISO 기준으로 고정한다. */
export function formatDate(date: Date | null | undefined): string {
  if (!date) return "-";
  return date.toISOString().slice(0, 10);
}

/** 0~1 유사도를 퍼센트 문자열로 */
export function formatSimilarity(similarity: number): string {
  return `${Math.round(similarity * 100)}%`;
}

/** 마감까지 남은 일수. 마감일이 없으면 null */
export function daysUntil(date: Date | null | undefined): number | null {
  if (!date) return null;
  const diff = date.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

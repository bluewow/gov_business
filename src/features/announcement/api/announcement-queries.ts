import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  announcementAttachments,
  announcements,
  db,
  ingestionRuns,
} from "@/db";

/** 모집중 = 마감일이 없거나 아직 지나지 않음 */
export function isOpenCondition() {
  return or(
    isNull(announcements.endDate),
    gte(announcements.endDate, new Date()),
  );
}

/** 마감 = 마감일이 있고 이미 지났음. 상시 공고(endDate NULL)는 마감되지 않는다. */
export function isClosedCondition() {
  return and(
    isNotNull(announcements.endDate),
    lt(announcements.endDate, new Date()),
  )!;
}

export const ANNOUNCEMENT_STATUSES = ["open", "closed", "all"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_SORTS = ["deadline", "recent"] as const;
export type AnnouncementSort = (typeof ANNOUNCEMENT_SORTS)[number];

export const DEFAULT_STATUS: AnnouncementStatus = "open";
export const DEFAULT_SORT: AnnouncementSort = "deadline";

/** 쿼리스트링은 아무 값이나 올 수 있으므로 허용된 값만 통과시킨다 */
export function parseStatus(value: unknown): AnnouncementStatus {
  return ANNOUNCEMENT_STATUSES.includes(value as AnnouncementStatus)
    ? (value as AnnouncementStatus)
    : DEFAULT_STATUS;
}

export function parseSort(value: unknown): AnnouncementSort {
  return ANNOUNCEMENT_SORTS.includes(value as AnnouncementSort)
    ? (value as AnnouncementSort)
    : DEFAULT_SORT;
}

/** 검색어 최대 길이 — 쿼리스트링으로 아무 길이나 들어올 수 있어 잘라 둔다 */
const MAX_QUERY_LENGTH = 60;

export function parseQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
}

/** LIKE 와일드카드(%, _)와 이스케이프 문자를 리터럴로 취급한다 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 제목 검색 조건.
 * 띄어쓴 낱말은 모두 포함해야 통과한다 — "창업 교육" 이 "창업기업 교육 프로그램" 에도 걸리도록.
 */
function titleSearchCondition(query: string): SQL | undefined {
  const words = query.split(" ").filter(Boolean);
  if (words.length === 0) return undefined;

  return and(
    ...words.map((word) => ilike(announcements.title, `%${escapeLike(word)}%`)),
  );
}

export interface AnnouncementListFilter {
  status?: AnnouncementStatus;
  sort?: AnnouncementSort;
  /** 제목 검색어. 비우면 검색하지 않는다 */
  query?: string;
  limit?: number;
}

export async function listAnnouncements(filter: AnnouncementListFilter = {}) {
  const {
    status = DEFAULT_STATUS,
    sort = DEFAULT_SORT,
    query = "",
    limit = 30,
  } = filter;

  const closed = isClosedCondition();
  const statusCondition =
    status === "open"
      ? isOpenCondition()
      : status === "closed"
        ? closed
        : undefined;

  const rows = await db
    .select({
      id: announcements.id,
      source: announcements.source,
      title: announcements.title,
      summary: announcements.summary,
      url: announcements.url,
      category: announcements.category,
      region: announcements.region,
      agency: announcements.agency,
      startDate: announcements.startDate,
      endDate: announcements.endDate,
      isSample: announcements.isSample,
      attachmentCount: sql<number>`(
        SELECT count(*)::int FROM ${announcementAttachments}
        WHERE ${announcementAttachments.announcementId} = ${announcements.id}
      )`,
    })
    .from(announcements)
    .where(and(statusCondition, titleSearchCondition(query)))
    .orderBy(
      ...(sort === "recent"
        ? [desc(announcements.createdAt)]
        : [
            // 전체 보기에서 이미 마감된 공고가 위로 올라오지 않도록 그룹부터 나눈다
            // (Postgres 는 boolean ASC 에서 false 를 먼저 준다)
            closed,
            // 마감 임박순. 상시 공고(endDate NULL)는 뒤로 보낸다.
            sql`${announcements.endDate} ASC NULLS LAST`,
            desc(announcements.createdAt),
          ]),
    )
    .limit(limit);

  return rows;
}

export type AnnouncementListItem = Awaited<
  ReturnType<typeof listAnnouncements>
>[number];

export interface AnnouncementStats {
  total: number;
  open: number;
  embedded: number;
  lastIngestedAt: Date | null;
}

export async function getAnnouncementStats(): Promise<AnnouncementStats> {
  const [[totals], [lastRun]] = await Promise.all([
    db
      .select({
        total: count(),
        open: sql<number>`count(*) FILTER (WHERE ${isOpenCondition()})::int`,
        embedded: sql<number>`count(*) FILTER (WHERE ${announcements.embedding} IS NOT NULL)::int`,
      })
      .from(announcements),
    db
      .select({ finishedAt: ingestionRuns.finishedAt })
      .from(ingestionRuns)
      .where(
        and(
          eq(ingestionRuns.status, "SUCCESS"),
          isNotNull(ingestionRuns.finishedAt),
        ),
      )
      .orderBy(desc(ingestionRuns.finishedAt))
      .limit(1),
  ]);

  return {
    total: totals?.total ?? 0,
    open: totals?.open ?? 0,
    embedded: totals?.embedded ?? 0,
    lastIngestedAt: lastRun?.finishedAt ?? null,
  };
}

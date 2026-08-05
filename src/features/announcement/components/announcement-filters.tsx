import { LinkButton } from "@/components/common/link-button";

import type {
  AnnouncementSort,
  AnnouncementStatus,
} from "../api/announcement-queries";

/**
 * 상태·정렬 필터.
 *
 * 상태를 URL 쿼리스트링으로 들고 있어 클라이언트 상태가 필요 없다 —
 * 링크만 렌더하는 서버 컴포넌트이고, 링크를 공유하면 같은 화면이 그대로 열린다.
 */

const STATUS_OPTIONS: { value: AnnouncementStatus; label: string }[] = [
  { value: "open", label: "모집중" },
  { value: "closed", label: "마감" },
  { value: "all", label: "전체" },
];

const SORT_OPTIONS: { value: AnnouncementSort; label: string }[] = [
  { value: "deadline", label: "마감 임박순" },
  { value: "recent", label: "최근 수집순" },
];

export function AnnouncementFilters({
  status,
  sort,
  query = "",
}: {
  status: AnnouncementStatus;
  sort: AnnouncementSort;
  /** 검색 중이면 필터를 바꿔도 검색어를 유지한다 */
  query?: string;
}) {
  const hrefFor = (next: {
    status?: AnnouncementStatus;
    sort?: AnnouncementSort;
  }) => ({
    pathname: "/announcements",
    query: {
      status: next.status ?? status,
      sort: next.sort ?? sort,
      ...(query ? { q: query } : {}),
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">상태</span>
        <div className="inline-flex gap-0.5 rounded-lg border p-0.5">
          {STATUS_OPTIONS.map((option) => (
            <LinkButton
              key={option.value}
              size="xs"
              variant={status === option.value ? "secondary" : "ghost"}
              aria-current={status === option.value ? "true" : undefined}
              href={hrefFor({ status: option.value })}
            >
              {option.label}
            </LinkButton>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">정렬</span>
        <div className="inline-flex gap-0.5 rounded-lg border p-0.5">
          {SORT_OPTIONS.map((option) => (
            <LinkButton
              key={option.value}
              size="xs"
              variant={sort === option.value ? "secondary" : "ghost"}
              aria-current={sort === option.value ? "true" : undefined}
              href={hrefFor({ sort: option.value })}
            >
              {option.label}
            </LinkButton>
          ))}
        </div>
      </div>
    </div>
  );
}

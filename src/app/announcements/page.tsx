import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { LinkButton } from "@/components/common/link-button";
import {
  AnnouncementFilters,
  AnnouncementList,
  AnnouncementSearch,
  getAnnouncementStats,
  listAnnouncements,
  parseQuery,
  parseSort,
  parseStatus,
} from "@/features/announcement";
import { getSavedAnnouncementIds } from "@/features/application";
import { getPrimaryBusiness } from "@/lib/current-user";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "공고 목록" };

// DB 를 읽으므로 프리렌더하지 않는다 (빌드 시점에 DB 가 없어도 빌드가 통과해야 한다)
export const dynamic = "force-dynamic";

/** 한 화면에 보여줄 최대 건수 */
const PAGE_SIZE = 30;

export default async function AnnouncementsPage({
  searchParams,
}: PageProps<"/announcements">) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const sort = parseSort(params.sort);
  const query = parseQuery(params.q);

  const [items, stats, savedIds, business] = await Promise.all([
    listAnnouncements({ status, sort, query, limit: PAGE_SIZE }),
    getAnnouncementStats(),
    getSavedAnnouncementIds(),
    getPrimaryBusiness(),
  ]);

  return (
    <PageShell
      step={2}
      title="공고 목록"
      description="수집된 공고를 상태·정렬로 추려서 봅니다. 관심 있는 공고는 바로 지원서로 담을 수 있습니다."
      actions={
        <>
          <LinkButton variant="outline" size="sm" href="/ingestion">
            수집 현황
          </LinkButton>
          <LinkButton variant="outline" size="sm" href="/recommendations">
            맞춤 추천
          </LinkButton>
        </>
      }
    >
      <dl className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs">전체</dt>
          <dd className="text-foreground font-medium">{stats.total}건</dd>
        </div>
        <div>
          <dt className="text-xs">모집중</dt>
          <dd className="text-foreground font-medium">{stats.open}건</dd>
        </div>
        <div>
          <dt className="text-xs">임베딩 완료</dt>
          <dd className="text-foreground font-medium">{stats.embedded}건</dd>
        </div>
        <div>
          <dt className="text-xs">마지막 수집</dt>
          <dd className="text-foreground font-medium">
            {formatDate(stats.lastIngestedAt)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2 border-y py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <AnnouncementFilters status={status} sort={sort} query={query} />
          <AnnouncementSearch query={query} status={status} sort={sort} />
        </div>
        {query ? (
          <p className="text-muted-foreground text-xs">
            제목에 「{query}」 가 들어간 공고 {items.length}건
            {items.length >= PAGE_SIZE ? ` (상위 ${PAGE_SIZE}건만 표시)` : ""}
          </p>
        ) : items.length >= PAGE_SIZE ? (
          <p className="text-muted-foreground text-xs">
            상위 {PAGE_SIZE}건만 표시합니다. 제목으로 검색하거나 「맞춤
            추천」에서 키워드로 좁혀 보세요.
          </p>
        ) : null}
      </div>

      <AnnouncementList
        items={items}
        savedIds={[...savedIds]}
        canSave={Boolean(business)}
        hasAnyAnnouncement={stats.total > 0}
        query={query}
      />
    </PageShell>
  );
}

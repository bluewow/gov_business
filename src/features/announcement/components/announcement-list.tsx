import {
  AnnouncementTitle,
  SampleBadge,
} from "@/components/common/announcement-title";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SaveApplicationButton } from "@/features/application/client";
import { daysUntil, formatDate } from "@/lib/format";

import type { AnnouncementListItem } from "../api/announcement-queries";

export function AnnouncementList({
  items,
  savedIds = [],
  canSave = true,
  hasAnyAnnouncement = true,
  query = "",
}: {
  items: AnnouncementListItem[];
  /** 이미 지원서로 담아둔 공고 id */
  savedIds?: string[];
  /** 사업 프로필이 없으면 담기 버튼을 숨긴다 */
  canSave?: boolean;
  /** 수집된 공고가 하나라도 있는지 — 비어 있는 이유가 필터인지 수집 전인지 구분한다 */
  hasAnyAnnouncement?: boolean;
  /** 적용된 제목 검색어 — 결과가 없을 때 안내 문구를 가른다 */
  query?: string;
}) {
  const saved = new Set(savedIds);

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {query ? (
          <p>
            제목에 「{query}」 가 들어간 공고가 없습니다. 검색어를 줄이거나 상태
            필터를 「전체」로 바꿔 보세요.
          </p>
        ) : hasAnyAnnouncement ? (
          <p>조건에 맞는 공고가 없습니다. 상태 필터를 바꿔 보세요.</p>
        ) : (
          <>
            <p>아직 수집된 공고가 없습니다.</p>
            <p className="mt-2">
              <code className="bg-muted rounded px-1.5 py-0.5">
                pnpm db:seed
              </code>{" "}
              로 샘플을 넣거나{" "}
              <code className="bg-muted rounded px-1.5 py-0.5">
                pnpm ingest
              </code>{" "}
              로 실제 공고를 수집하세요.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const remaining = daysUntil(item.endDate);
        return (
          <Card key={item.id} size="sm">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{item.source}</Badge>
                {item.isSample ? <SampleBadge /> : null}
                {item.region ? (
                  <Badge variant="ghost">{item.region}</Badge>
                ) : null}
                {item.category ? (
                  <Badge variant="outline">{item.category}</Badge>
                ) : null}
                {remaining !== null && remaining >= 0 ? (
                  <Badge variant={remaining <= 7 ? "destructive" : "ghost"}>
                    D-{remaining}
                  </Badge>
                ) : null}
                {item.attachmentCount > 0 ? (
                  <Badge variant="ghost">첨부 {item.attachmentCount}</Badge>
                ) : null}
              </div>
              <CardTitle className="text-base leading-6">
                <AnnouncementTitle
                  title={item.title}
                  url={item.url}
                  isSample={item.isSample}
                />
              </CardTitle>
              <CardDescription>
                {item.agency ? `${item.agency} · ` : ""}
                {formatDate(item.startDate)} ~ {formatDate(item.endDate)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {item.summary ? (
                <p className="text-muted-foreground line-clamp-2 text-sm leading-6">
                  {item.summary}
                </p>
              ) : null}
              {canSave ? (
                <SaveApplicationButton
                  announcementId={item.id}
                  saved={saved.has(item.id)}
                />
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

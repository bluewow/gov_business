import Link from "next/link";

import { LinkButton } from "@/components/common/link-button";
import { SampleBadge } from "@/components/common/announcement-title";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { daysUntil, formatDate } from "@/lib/format";

import type { ApplicationListItem } from "../api/application-queries";
import { STATUS_LABELS } from "../status";

export function ApplicationList({ items }: { items: ApplicationListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm">
        <p>아직 담아둔 공고가 없습니다.</p>
        <p>맞춤 추천에서 관심 있는 공고를 지원서로 담아 보세요.</p>
        <LinkButton variant="outline" size="sm" href="/recommendations">
          맞춤 추천 보기
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const remaining = daysUntil(item.announcement.endDate);
        return (
          <Card key={item.id} size="sm">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{STATUS_LABELS[item.status]}</Badge>
                {item.announcement.isSample ? <SampleBadge /> : null}
                {item.review ? (
                  <Badge
                    variant={item.review.fitScore >= 70 ? "default" : "outline"}
                  >
                    적합도 {item.review.fitScore}점
                  </Badge>
                ) : (
                  <Badge variant="ghost">검토 전</Badge>
                )}
                {item.draftCount > 0 ? (
                  <Badge variant="ghost">초안 {item.draftCount}개</Badge>
                ) : null}
                {remaining !== null && remaining >= 0 ? (
                  <Badge variant={remaining <= 7 ? "destructive" : "ghost"}>
                    D-{remaining}
                  </Badge>
                ) : remaining !== null ? (
                  <Badge variant="destructive">마감</Badge>
                ) : null}
              </div>
              <CardTitle className="text-base leading-6">
                <Link
                  href={`/applications/${item.id}`}
                  className="hover:underline"
                >
                  {item.announcement.title}
                </Link>
              </CardTitle>
              <CardDescription>
                {item.announcement.agency
                  ? `${item.announcement.agency} · `
                  : ""}
                마감 {formatDate(item.announcement.endDate)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {item.review?.summary ? (
                <p className="text-muted-foreground line-clamp-2 text-sm leading-6">
                  {item.review.summary}
                </p>
              ) : null}
              <LinkButton
                variant="outline"
                size="sm"
                className="self-start"
                href={`/applications/${item.id}`}
              >
                검토 · 작성하기
              </LinkButton>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

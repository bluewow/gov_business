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
import { daysUntil, formatDate, formatSimilarity } from "@/lib/format";

import type { RecommendResult, RecommendationItem } from "../types";

function ScoreBadge({
  item,
  mode,
}: {
  item: RecommendationItem;
  mode: string;
}) {
  if (item.llmScore !== null) {
    return (
      <Badge variant={item.llmScore >= 70 ? "default" : "secondary"}>
        적합도 {item.llmScore}점
      </Badge>
    );
  }
  if (mode === "vector") {
    return (
      <Badge variant="outline">
        유사도 {formatSimilarity(item.similarity)}
      </Badge>
    );
  }
  return <Badge variant="outline">키워드 일치</Badge>;
}

/**
 * 이 공고가 왜 후보에 들었는지.
 * 키워드가 안 걸렸는데도 올라온 공고를 "의미 유사" 로 밝혀 준다 —
 * 키워드는 게이트가 아니라 힌트라는 걸 결과에서 바로 알 수 있게.
 */
function MatchReasonBadges({
  item,
  hasKeywords,
}: {
  item: RecommendationItem;
  hasKeywords: boolean;
}) {
  if (!hasKeywords) return null;

  if (item.matchedKeywords.length === 0) {
    return <Badge variant="secondary">의미 유사</Badge>;
  }

  return (
    <>
      {item.matchedKeywords.map((keyword) => (
        <Badge key={keyword} variant="outline">
          #{keyword}
        </Badge>
      ))}
    </>
  );
}

function DeadlineBadge({ endDate }: { endDate: Date | null }) {
  const remaining = daysUntil(endDate);
  if (remaining === null) return <Badge variant="ghost">상시</Badge>;
  if (remaining < 0) return <Badge variant="destructive">마감</Badge>;
  return (
    <Badge variant={remaining <= 7 ? "destructive" : "ghost"}>
      D-{remaining}
    </Badge>
  );
}

export function RecommendationList({
  result,
  savedIds,
}: {
  result: RecommendResult;
  /** 이미 지원서로 담아둔 공고 id */
  savedIds: string[];
}) {
  if (result.error) {
    return (
      <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm">
        {result.error}
      </p>
    );
  }

  if (result.items.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        {result.notice ?? "추천 결과가 없습니다."}
      </p>
    );
  }

  const saved = new Set(savedIds);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">
        {result.keywords.length > 0
          ? `키워드 「${result.keywords.join(result.keywordMode === "all" ? " + " : ", ")}」 ${
              result.items.filter((item) => item.matchedBy === "keyword").length
            }건 + 의미 유사 ${
              result.items.filter((item) => item.matchedBy === "semantic")
                .length
            }건`
          : `키워드 없이 사업 프로필과 가까운 순서로 ${result.items.length}건`}
      </p>

      {result.notice ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
          {result.notice}
        </p>
      ) : null}

      {result.items.map((item) => (
        <Card key={item.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <ScoreBadge item={item} mode={result.mode} />
              <DeadlineBadge endDate={item.endDate} />
              <Badge variant="secondary">
                {[item.source, ...item.duplicateSources].join(" · ")}
              </Badge>
              {item.isSample ? <SampleBadge /> : null}
              {item.region ? (
                <Badge variant="ghost">{item.region}</Badge>
              ) : null}
              <MatchReasonBadges
                item={item}
                hasKeywords={result.keywords.length > 0}
              />
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
              접수 {formatDate(item.startDate)} ~ {formatDate(item.endDate)}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            {item.llmReason ? (
              <p className="bg-muted/50 rounded-md p-3 text-sm leading-6">
                {item.llmReason}
              </p>
            ) : null}
            <p className="text-muted-foreground line-clamp-3 text-sm leading-6">
              {item.summary ?? item.content}
            </p>
            {item.targetAudience ? (
              <p className="text-muted-foreground text-xs">
                지원대상: {item.targetAudience}
              </p>
            ) : null}
            <SaveApplicationButton
              announcementId={item.id}
              similarity={item.similarity}
              saved={saved.has(item.id)}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

"use client";

import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { useRouter } from "next/navigation";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRuntimeKeys } from "@/stores/api-keys-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EligibilityVerdict } from "@/db/schema";

import { runReview } from "../actions";
import type { ApplicationDetail } from "../api/application-queries";

const VERDICT_META: Record<
  EligibilityVerdict,
  { label: string; icon: typeof CircleCheck; className: string }
> = {
  MET: { label: "충족", icon: CircleCheck, className: "text-foreground" },
  UNMET: { label: "미충족", icon: CircleAlert, className: "text-destructive" },
  UNKNOWN: {
    label: "확인 필요",
    icon: CircleHelp,
    className: "text-muted-foreground",
  },
};

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{title}</p>
      <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm leading-6">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ReviewPanel({
  application,
}: {
  application: ApplicationDetail;
}) {
  const router = useRouter();
  const keys = useRuntimeKeys();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const review = application.review;

  function handleReview() {
    setError(null);
    startTransition(async () => {
      const result = await runReview(application.id, keys);
      if (!result.ok) {
        setError(result.error ?? "검토에 실패했습니다.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">AI 요건 검토</h2>
          <p className="text-muted-foreground text-xs">
            공고의 자격요건을 항목별로 쪼개 내 사업과 대조합니다.
          </p>
        </div>
        <Button size="sm" onClick={handleReview} disabled={isPending}>
          {isPending ? "검토 중…" : review ? "다시 검토" : "AI 검토 실행"}
        </Button>
      </div>

      {error ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      {!review ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          아직 검토하지 않았습니다. 검토를 실행하면 지원 자격 충족 여부와 보완
          사항을 정리해 줍니다.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Card size="sm">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={review.fitScore >= 70 ? "default" : "secondary"}
                >
                  적합도 {review.fitScore}점
                </Badge>
                <Badge variant="ghost">{review.model}</Badge>
              </div>
              <CardTitle className="text-base leading-6">총평</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm leading-6">{review.summary}</p>
              <BulletList title="강점" items={review.strengths} />
              <BulletList title="약점" items={review.weaknesses} />
              <BulletList title="지금 할 일" items={review.actionItems} />
            </CardContent>
          </Card>

          {review.checks.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">자격요건 체크</p>
              <ul className="flex flex-col gap-2">
                {review.checks.map((check) => {
                  const meta = VERDICT_META[check.verdict];
                  const Icon = meta.icon;
                  return (
                    <li
                      key={check.id}
                      className="flex items-start gap-2.5 rounded-lg border p-3"
                    >
                      <Icon
                        className={`mt-0.5 size-4 shrink-0 ${meta.className}`}
                        aria-hidden
                      />
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium">
                          {check.requirement}
                          <span className="text-muted-foreground ml-2 text-xs font-normal">
                            {meta.label}
                          </span>
                        </p>
                        {check.note ? (
                          <p className="text-muted-foreground text-sm leading-6">
                            {check.note}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

"use client";

import { Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useRuntimeKeys } from "@/stores/api-keys-store";

import { runStrategy } from "../actions";
import type { ApplicationDetail } from "../api/application-queries";
import { DRAFT_SECTIONS } from "../sections";

/**
 * 합격 전략 패널 — 요건 검토(지원 가능한가)와 초안(실제 작성) 사이의 다리.
 * "이 공고에서 이기려면 무엇을 어떻게 부각해야 하는가"를 보여 주고,
 * 여기서 나온 섹션별 가이드를 아래 초안 생성이 그대로 따른다.
 */
export function StrategyPanel({
  application,
}: {
  application: ApplicationDetail;
}) {
  const router = useRouter();
  const keys = useRuntimeKeys();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const strategy = application.strategy;

  const hasAttachmentText = application.announcement.attachments.some(
    (item) => item.parseStatus === "PARSED",
  );

  function handleRun() {
    setError(null);
    startTransition(async () => {
      const result = await runStrategy(application.id, keys);
      if (!result.ok) {
        setError(result.error ?? "전략 수립에 실패했습니다.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">합격 전략</h2>
          <p className="text-muted-foreground text-xs">
            이 공고의 심사 관점에서 내 사업을 어떻게 부각할지 정합니다. 아래
            초안 생성이 이 전략을 그대로 따릅니다.
          </p>
        </div>
        <Button size="sm" onClick={handleRun} disabled={isPending}>
          {isPending ? "수립 중…" : strategy ? "다시 수립" : "전략 수립"}
        </Button>
      </div>

      {error ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      {!strategy ? (
        <div className="text-muted-foreground flex flex-col gap-2 rounded-lg border border-dashed p-6 text-sm">
          <p>
            아직 전략이 없습니다. 수립하면 포지셔닝 · 심사 포인트 · 전략
            포인트와 섹션별 작성 가이드가 만들어집니다.
          </p>
          {!hasAttachmentText ? (
            <p className="text-xs">
              💡 위에서 첨부 공고문을 먼저 추출하면 평가기준·배점까지 근거로
              삼아 훨씬 구체적인 전략이 나옵니다.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card size="sm">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">
                  <Target className="size-3" aria-hidden />
                  포지셔닝
                </Badge>
                <Badge variant="ghost">{strategy.model}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm leading-6">{strategy.positioning}</p>

              {strategy.evaluationFocus.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium">심사가 점수를 주는 것</p>
                  <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm leading-6">
                    {strategy.evaluationFocus.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {strategy.strategyPoints.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">전략 포인트</p>
              <ul className="flex flex-col gap-2">
                {strategy.strategyPoints.map((point) => (
                  <li
                    key={point.title}
                    className="flex flex-col gap-1 rounded-lg border p-3"
                  >
                    <p className="text-sm font-medium">{point.title}</p>
                    <p className="text-muted-foreground text-sm leading-6">
                      {point.detail}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {Object.keys(strategy.sectionGuides).length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">
                섹션별 작성 가이드
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  아래 초안 생성이 이 가이드를 따릅니다
                </span>
              </p>
              <ul className="flex flex-col gap-2">
                {DRAFT_SECTIONS.map((section) => {
                  const guide = strategy.sectionGuides[section.key];
                  if (!guide) return null;
                  return (
                    <li
                      key={section.key}
                      className="bg-muted/40 flex flex-col gap-1 rounded-lg p-3"
                    >
                      <p className="text-xs font-medium">{section.title}</p>
                      <p className="text-muted-foreground text-sm leading-6">
                        {guide}
                      </p>
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

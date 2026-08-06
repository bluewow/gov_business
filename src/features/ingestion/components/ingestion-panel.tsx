"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useEffect, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRuntimeKeys } from "@/stores/api-keys-store";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AnnouncementSource } from "@/db/schema";
import { formatDate } from "@/lib/format";

import { runEmbedding, runIngestion } from "../actions";
import type { EmbeddingStatus, SourceStatus } from "../api/ingestion-queries";

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="ghost">실행 이력 없음</Badge>;
  if (status === "SUCCESS") return <Badge variant="secondary">성공</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">실패</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export function IngestionPanel({
  sources,
  embedding,
  ingestionRunning,
}: {
  sources: SourceStatus[];
  embedding: EmbeddingStatus;
  /** 백그라운드 수집이 돌고 있는지 (잠금 점유 기준) */
  ingestionRunning: boolean;
}) {
  const router = useRouter();
  const keys = useRuntimeKeys();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function collect(source?: AnnouncementSource) {
    setMessage(null);
    setRunning(source ?? "ALL");
    startTransition(async () => {
      const result = await runIngestion(source, keys);
      setMessage(
        result.error
          ? `수집 실패: ${result.error}`
          : "백그라운드에서 수집을 시작했습니다. 페이지를 옮겨도 계속 진행되며, 결과는 아래 실행 이력에 남습니다.",
      );
      setRunning(null);
      // 잠금이 이미 잡혀 있으므로 곧바로 새로고침하면 화면이 「진행 중」을 본다
      router.refresh();
    });
  }

  function embed() {
    setMessage(null);
    setRunning("EMBED");
    startTransition(async () => {
      const result = await runEmbedding(keys);
      setMessage(
        result.error
          ? `임베딩 실패: ${result.error}`
          : "백그라운드에서 임베딩을 시작했습니다. 페이지를 옮기거나 창을 닫아도 계속 진행됩니다.",
      );
      setRunning(null);
      // 잠금이 이미 잡혀 있으므로 곧바로 새로고침하면 화면이 「진행 중」을 본다
      router.refresh();
    });
  }

  // 진행 중이면 주기적으로 새로고침해 진행률을 갱신한다.
  // 서버가 잠금 해제를 보고 running=false 를 주면 이 효과가 정리되며 폴링도 멈춘다.
  const anyRunning = embedding.running || ingestionRunning;
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [anyRunning, router]);

  // 서버 .env 든 이 탭에 넣은 키든 하나라도 있으면 임베딩을 돌릴 수 있다
  const canEmbed = embedding.aiEnabled || Boolean(keys.openai);

  const embeddedRatio =
    embedding.total === 0
      ? 0
      : Math.round((embedding.embedded / embedding.total) * 100);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">수집 소스</h2>
          <Button
            size="sm"
            onClick={() => collect()}
            disabled={isPending || ingestionRunning}
          >
            {ingestionRunning
              ? "수집 진행 중…"
              : running === "ALL"
                ? "시작하는 중…"
                : "전체 수집"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {sources.map((source) => {
            // 서버 .env 뿐 아니라 이 탭에 입력한 휘발성 키도 "설정 완료"로 친다
            const configured =
              source.configured ||
              (source.requiresKey ? Boolean(keys[source.requiresKey]) : false);
            return (
              <Card key={source.source} size="sm">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={source.lastRunStatus} />
                    {configured ? (
                      <Badge variant="ghost">설정 완료</Badge>
                    ) : (
                      <Badge variant="outline">설정 필요</Badge>
                    )}
                  </div>
                  <CardTitle className="text-base">{source.label}</CardTitle>
                  <CardDescription>
                    공고 {source.announcementCount}건 · 최근 실행{" "}
                    {formatDate(source.lastRunAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {source.lastRunError ? (
                    <p className="text-destructive line-clamp-2 text-xs leading-5">
                      {source.lastRunError}
                    </p>
                  ) : null}
                  {!configured ? (
                    <p className="text-muted-foreground text-xs leading-5">
                      위 「API 키」 패널에 키를 넣거나 .env.local 을 채우면
                      수집이 활성화됩니다.
                    </p>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={isPending || ingestionRunning}
                    onClick={() => collect(source.source)}
                  >
                    {running === source.source
                      ? "시작하는 중…"
                      : "이 소스만 수집"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">임베딩 상태</h2>
        <Card size="sm">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {embedding.embedded} / {embedding.total}건 임베딩 완료
                {embedding.running ? (
                  <span className="text-foreground ml-2">
                    · 진행 중 (남은 {embedding.pending}건)
                  </span>
                ) : null}
              </span>
              <span className="font-medium">{embeddedRatio}%</span>
            </div>
            <Progress value={embeddedRatio} />
            <p className="text-muted-foreground text-xs leading-5">
              임베딩되지 않은 공고는 의미 기반 추천 대상에서 빠집니다. 첨부파일
              파싱 대기 {embedding.attachmentsPending}건.
              {embedding.excluded > 0 ? (
                <>
                  {" "}
                  마감·샘플 {embedding.excluded}건은 추천에 쓰이지 않아 비용
                  절약을 위해 대상에서 제외했습니다.
                </>
              ) : null}
            </p>
            {!canEmbed ? (
              <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border p-3 text-xs leading-5">
                OpenAI API 키가 없어 임베딩을 만들 수 없습니다.{" "}
                <Link
                  href="/settings/api-keys"
                  className="underline underline-offset-4"
                >
                  설정 → API 키
                </Link>{" "}
                에서 입력하거나 .env.local 에 OPENAI_API_KEY 를 추가하세요.
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={
                isPending ||
                embedding.running ||
                embedding.pending === 0 ||
                !canEmbed
              }
              onClick={embed}
            >
              {embedding.running
                ? "임베딩 진행 중…"
                : running === "EMBED"
                  ? "시작하는 중…"
                  : `미임베딩 ${embedding.pending}건 처리`}
            </Button>
          </CardContent>
        </Card>
      </section>

      {message ? (
        <p className="rounded-lg border border-dashed p-3 text-sm">{message}</p>
      ) : null}
    </div>
  );
}

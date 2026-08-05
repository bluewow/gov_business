"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useState, useTransition } from "react";

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
import type { IngestionResult } from "../types";

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="ghost">실행 이력 없음</Badge>;
  if (status === "SUCCESS") return <Badge variant="secondary">성공</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">실패</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export function IngestionPanel({
  sources,
  embedding,
}: {
  sources: SourceStatus[];
  embedding: EmbeddingStatus;
}) {
  const router = useRouter();
  const keys = useRuntimeKeys();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<IngestionResult[] | null>(null);
  const [embedMessage, setEmbedMessage] = useState<string | null>(null);

  function collect(source?: AnnouncementSource) {
    setResults(null);
    setEmbedMessage(null);
    setRunning(source ?? "ALL");
    startTransition(async () => {
      const next = await runIngestion(source, keys);
      setResults(next);
      setRunning(null);
      router.refresh();
    });
  }

  function embed() {
    setResults(null);
    setEmbedMessage(null);
    setRunning("EMBED");
    startTransition(async () => {
      const result = await runEmbedding(keys);
      setEmbedMessage(
        result.error
          ? `임베딩 실패: ${result.error}`
          : `임베딩 ${result.embedded}건 생성했습니다.`,
      );
      setRunning(null);
      router.refresh();
    });
  }

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
          <Button size="sm" onClick={() => collect()} disabled={isPending}>
            {running === "ALL" ? "수집 중…" : "전체 수집"}
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
                    disabled={isPending}
                    onClick={() => collect(source.source)}
                  >
                    {running === source.source ? "수집 중…" : "이 소스만 수집"}
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
              disabled={isPending || embedding.pending === 0 || !canEmbed}
              onClick={embed}
            >
              {running === "EMBED"
                ? "임베딩 중…"
                : `미임베딩 ${embedding.pending}건 처리`}
            </Button>
          </CardContent>
        </Card>
      </section>

      {results ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">실행 결과</h2>
          {results.map((result) => (
            <div
              key={result.source}
              className="rounded-lg border p-3 text-sm leading-6"
            >
              <span className="font-medium">{result.source}</span> — 수집{" "}
              {result.fetched} · 신규 {result.created} · 갱신 {result.updated} ·
              임베딩 {result.embedded}
              {result.skippedReason ? (
                <p className="text-muted-foreground text-xs">
                  {result.skippedReason}
                </p>
              ) : null}
              {result.error ? (
                <p className="text-destructive text-xs">{result.error}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {embedMessage ? (
        <p className="rounded-lg border border-dashed p-3 text-sm">
          {embedMessage}
        </p>
      ) : null}
    </div>
  );
}

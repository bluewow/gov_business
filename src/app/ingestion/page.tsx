import type { Metadata } from "next";

import { ApiKeysPanel } from "@/components/common/api-keys-panel";
import { LinkButton } from "@/components/common/link-button";
import { PageShell } from "@/components/layout/page-shell";
import {
  getEmbeddingStatus,
  getSourceStatuses,
  IngestionPanel,
  IngestionRuns,
  isIngestionRunning,
  listIngestionRuns,
} from "@/features/ingestion";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "수집 현황" };
export const dynamic = "force-dynamic";

export default async function IngestionPage() {
  const [sources, embedding, runs, ingestionRunning] = await Promise.all([
    getSourceStatuses(),
    getEmbeddingStatus(),
    listIngestionRuns(15),
    isIngestionRunning(),
  ]);

  // 값이 아니라 "존재 여부"만 내려보낸다 — 서버 키가 브라우저로 새면 안 된다
  const fallback = {
    dataGoKr: Boolean(env.dataGoKrServiceKey()),
    openai: Boolean(env.openaiApiKey()),
  };

  return (
    <PageShell
      step={2}
      title="공고 수집"
      description={
        <>
          K-Startup API 와 기업마당·이지비즈 스크레이퍼로 공고를 모으고,
          첨부파일 텍스트를 추출한 뒤 임베딩까지 만듭니다.{" "}
          <strong className="text-foreground">
            수집은 수동으로만 실행됩니다
          </strong>{" "}
          — 자동으로 도는 스케줄러가 없으므로 아래 버튼을 눌러야 공고가
          들어옵니다. (터미널에서는{" "}
          <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
            pnpm ingest
          </code>
          )
        </>
      }
      actions={
        <LinkButton variant="outline" size="sm" href="/announcements">
          공고 목록
        </LinkButton>
      }
    >
      <ApiKeysPanel fallback={fallback} />

      <IngestionPanel
        sources={sources}
        embedding={embedding}
        ingestionRunning={ingestionRunning}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">실행 이력</h2>
        <IngestionRuns runs={runs} />
      </section>
    </PageShell>
  );
}

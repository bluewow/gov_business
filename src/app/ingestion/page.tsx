import type { Metadata } from "next";

import { ApiKeysPanel } from "@/components/common/api-keys-panel";
import { LinkButton } from "@/components/common/link-button";
import { PageShell } from "@/components/layout/page-shell";
import {
  getEmbeddingStatus,
  getSourceStatuses,
  IngestionPanel,
  IngestionRuns,
  listIngestionRuns,
} from "@/features/ingestion";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "수집 현황" };
export const dynamic = "force-dynamic";

export default async function IngestionPage() {
  const [sources, embedding, runs] = await Promise.all([
    getSourceStatuses(),
    getEmbeddingStatus(),
    listIngestionRuns(15),
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
          첨부파일 텍스트를 추출한 뒤 임베딩까지 만듭니다. 정기 실행은{" "}
          <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
            /api/cron/ingest
          </code>{" "}
          엔드포인트를 스케줄러에 걸어 두세요.
        </>
      }
      actions={
        <LinkButton variant="outline" size="sm" href="/announcements">
          공고 목록
        </LinkButton>
      }
    >
      <ApiKeysPanel fallback={fallback} />

      <IngestionPanel sources={sources} embedding={embedding} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">실행 이력</h2>
        <IngestionRuns runs={runs} />
      </section>
    </PageShell>
  );
}

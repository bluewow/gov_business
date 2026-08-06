import type { Metadata } from "next";

import { AiUsagePanel } from "@/components/common/ai-usage-panel";
import { ApiKeysPanel } from "@/components/common/api-keys-panel";
import { LinkButton } from "@/components/common/link-button";
import { PageShell } from "@/components/layout/page-shell";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "API 키" };
export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  // 값이 아니라 "존재 여부"만 내려보낸다 — 서버 키가 브라우저로 새면 안 된다
  const fallback = {
    dataGoKr: Boolean(env.dataGoKrServiceKey()),
    openai: Boolean(env.openaiApiKey()),
  };

  return (
    <PageShell
      title="API 키"
      description="공고 수집과 AI 기능에 쓰는 키입니다. 여기서 넣으면 이 탭에서만 유지되고 서버에 저장되지 않습니다."
      actions={
        <LinkButton variant="outline" size="sm" href="/ingestion">
          수집 현황
        </LinkButton>
      }
    >
      <ApiKeysPanel fallback={fallback} />

      <AiUsagePanel />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">어디에 쓰이나요</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th className="px-2 py-2 text-left font-medium">키</th>
                <th className="px-2 py-2 text-left font-medium">쓰이는 곳</th>
                <th className="px-2 py-2 text-left font-medium">없으면</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="px-2 py-2 whitespace-nowrap">
                  공공데이터포털 서비스키
                </td>
                <td className="px-2 py-2">STEP 2 K-Startup 공고 수집</td>
                <td className="text-muted-foreground px-2 py-2">
                  해당 소스만 건너뜀 (기업마당은 키 없이 동작)
                </td>
              </tr>
              <tr>
                <td className="px-2 py-2 whitespace-nowrap">OpenAI API 키</td>
                <td className="px-2 py-2">
                  STEP 1 프로필 임베딩 · STEP 2 공고 임베딩 · STEP 3 정밀 평가 ·
                  STEP 4 요건 검토/초안 작성
                </td>
                <td className="text-muted-foreground px-2 py-2">
                  추천이 키워드 검색으로 폴백, AI 검토·작성 비활성
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-muted-foreground text-xs leading-5">
          터미널 실행(
          <code className="bg-muted rounded px-1 py-0.5">
            pnpm ingest
          </code>,{" "}
          <code className="bg-muted rounded px-1 py-0.5">pnpm db:embed</code>
          )에는 이 입력이 닿지 않습니다. 그쪽까지 쓰려면
          <code className="bg-muted mx-1 rounded px-1 py-0.5">.env.local</code>
          에도 키를 넣어 두세요. 읽는 순서는{" "}
          <strong>화면 입력 키 → .env</strong> 입니다.
        </p>
      </section>
    </PageShell>
  );
}

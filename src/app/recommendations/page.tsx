import type { Metadata } from "next";
import Link from "next/link";

import { LinkButton } from "@/components/common/link-button";
import { PageShell } from "@/components/layout/page-shell";
import { getSavedAnnouncementIds } from "@/features/application";
import { getAnnouncementStats } from "@/features/announcement";
import { CurationPanel, extractKeywords } from "@/features/recommendation";
import { getPrimaryBusiness } from "@/lib/current-user";

export const metadata: Metadata = { title: "맞춤 추천" };
export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const [business, savedIds, stats] = await Promise.all([
    getPrimaryBusiness(),
    getSavedAnnouncementIds(),
    getAnnouncementStats(),
  ]);

  if (!business) {
    return (
      <PageShell
        step={3}
        title="맞춤 추천"
        description="내 사업 설명과 공고의 의미적 연관도를 계산해 큐레이션합니다."
      >
        <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm">
          <p>추천의 기준이 될 사업 프로필이 아직 없습니다.</p>
          <LinkButton variant="outline" size="sm" href="/business">
            사업 프로필 등록하기
          </LinkButton>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      step={3}
      title="맞춤 추천"
      description={
        <>
          기준 사업:{" "}
          <strong className="text-foreground">{business.title}</strong> ·{" "}
          <Link href="/business" className="underline underline-offset-4">
            프로필 수정
          </Link>
          <br />
          임베딩된 공고 {stats.embedded}건 / 전체 {stats.total}건에서 찾습니다.
          {business.embeddingHash
            ? ""
            : " 프로필 임베딩이 아직 없어 정확도가 떨어질 수 있습니다."}
        </>
      }
      actions={
        <LinkButton variant="outline" size="sm" href="/applications">
          담아둔 지원서
        </LinkButton>
      }
    >
      <CurationPanel
        savedIds={[...savedIds]}
        defaultKeywords={business.keywords}
        suggestedKeywords={[
          business.region,
          business.category,
          ...business.keywords,
          // 프로필에 키워드를 안 넣었어도 고를 거리가 남도록 설명에서 뽑아 채운다
          ...extractKeywords(business.description, 6),
        ].filter((keyword): keyword is string => Boolean(keyword))}
      />
    </PageShell>
  );
}

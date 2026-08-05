import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { LinkButton } from "@/components/common/link-button";
import { BusinessForm } from "@/features/business";
import { getPrimaryBusiness } from "@/lib/current-user";

export const metadata: Metadata = { title: "사업 프로필" };
export const dynamic = "force-dynamic";

export default async function BusinessPage() {
  const business = await getPrimaryBusiness();

  return (
    <PageShell
      step={1}
      title="사업 프로필"
      description="여기 적은 사업 설명이 추천·AI 검토 전 과정의 기준이 됩니다. 먼저 저장한 뒤 다음 단계로 넘어가세요."
      actions={
        business ? (
          <LinkButton variant="outline" size="sm" href="/recommendations">
            맞춤 추천 보기
          </LinkButton>
        ) : null
      }
    >
      <BusinessForm
        initial={{
          id: business?.id ?? null,
          title: business?.title ?? "",
          description: business?.description ?? "",
          region: business?.region ?? "",
          category: business?.category ?? "",
          businessAgeMonth:
            business?.businessAgeMonth !== null &&
            business?.businessAgeMonth !== undefined
              ? String(business.businessAgeMonth)
              : "",
          keywords: business?.keywords.join(", ") ?? "",
        }}
      />
    </PageShell>
  );
}

import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { LinkButton } from "@/components/common/link-button";
import { ApplicationList, listApplications } from "@/features/application";
import { getPrimaryBusiness } from "@/lib/current-user";

export const metadata: Metadata = { title: "지원 관리" };
export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const [business, applications] = await Promise.all([
    getPrimaryBusiness(),
    listApplications(),
  ]);

  return (
    <PageShell
      step={4}
      title="지원서"
      description="담아둔 공고마다 자격요건을 AI 로 검토하고, 사업계획서 초안을 섹션별로 만들어 다듬습니다."
      actions={
        <LinkButton variant="outline" size="sm" href="/recommendations">
          공고 더 담기
        </LinkButton>
      }
    >
      {!business ? (
        <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm">
          <p>먼저 사업 프로필을 등록해야 합니다.</p>
          <LinkButton variant="outline" size="sm" href="/business">
            사업 프로필 등록하기
          </LinkButton>
        </div>
      ) : (
        <ApplicationList items={applications} />
      )}
    </PageShell>
  );
}

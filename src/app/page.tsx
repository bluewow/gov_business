import { ArrowRight, Check } from "lucide-react";

import { LinkButton } from "@/components/common/link-button";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAnnouncementStats } from "@/features/announcement";
import { listApplications } from "@/features/application";
import { getPrimaryBusiness } from "@/lib/current-user";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Step {
  step: number;
  title: string;
  href: string;
  cta: string;
  done: boolean;
  status: string;
  hint: string;
}

export default async function DashboardPage() {
  const [business, stats, applications] = await Promise.all([
    getPrimaryBusiness(),
    getAnnouncementStats(),
    listApplications(),
  ]);

  const reviewed = applications.filter((item) => item.review).length;
  const withDrafts = applications.filter((item) => item.draftCount > 0).length;

  const steps: Step[] = [
    {
      step: 1,
      title: "내 사업 등록",
      href: "/business",
      cta: business ? "프로필 수정" : "프로필 등록",
      done: Boolean(business),
      status: business
        ? `${business.title}${business.embeddingHash ? " · 임베딩 완료" : " · 임베딩 없음"}`
        : "아직 등록 전",
      hint: "여기 적은 사업 설명이 추천과 AI 검토의 기준이 됩니다.",
    },
    {
      step: 2,
      title: "공고 수집",
      href: "/ingestion",
      cta: "수집 현황 보기",
      done: stats.total > 0,
      status:
        stats.total > 0
          ? `공고 ${stats.total}건 · 임베딩 ${stats.embedded}건 · 최근 수집 ${formatDate(stats.lastIngestedAt)}`
          : "수집된 공고 없음",
      hint: "K-Startup·이지비즈에서 공고를 모으고 첨부파일 텍스트까지 추출합니다.",
    },
    {
      step: 3,
      title: "맞춤 추천",
      href: "/recommendations",
      cta: "추천 받기",
      done: applications.length > 0,
      status:
        applications.length > 0
          ? `${applications.length}건을 지원서로 담아둠`
          : "아직 담아둔 공고 없음",
      hint: "지역·분야로 1차 필터링한 뒤 의미적 연관도로 정렬합니다.",
    },
    {
      step: 4,
      title: "AI 검토 · 작성",
      href: "/applications",
      cta: "지원서 열기",
      done: withDrafts > 0,
      status:
        applications.length > 0
          ? `검토 완료 ${reviewed}건 · 초안 작성 ${withDrafts}건`
          : "담아둔 공고가 없습니다",
      hint: "자격요건을 항목별로 검토하고 사업계획서 초안을 섹션별로 만듭니다.",
    },
  ];

  const nextStep = steps.find((step) => !step.done) ?? steps[steps.length - 1]!;

  return (
    <PageShell
      title="대시보드"
      description="공고 수집 → 맞춤 추천 → AI 검토·작성까지 한 흐름으로 진행합니다."
      actions={
        <LinkButton size="sm" href={nextStep.href}>
          {nextStep.cta}
          <ArrowRight className="size-3.5" aria-hidden />
        </LinkButton>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {steps.map((step) => (
          <Card key={step.step} size="sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Badge variant={step.done ? "default" : "outline"}>
                  {step.done ? (
                    <>
                      <Check className="size-3" aria-hidden /> 완료
                    </>
                  ) : (
                    `STEP ${step.step}`
                  )}
                </Badge>
                {step.step === nextStep.step && !step.done ? (
                  <Badge variant="secondary">지금 할 일</Badge>
                ) : null}
              </div>
              <CardTitle className="text-base">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm leading-6">{step.status}</p>
              <p className="text-muted-foreground text-xs leading-5">
                {step.hint}
              </p>
              <LinkButton
                variant="outline"
                size="sm"
                className="self-start"
                href={step.href}
              >
                {step.cta}
              </LinkButton>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

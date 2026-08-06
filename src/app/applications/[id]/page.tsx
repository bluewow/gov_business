import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/layout/page-shell";
import { SampleBadge } from "@/components/common/announcement-title";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LinkButton } from "@/components/common/link-button";
import {
  ApplicationStatusControl,
  AttachmentPanel,
  DraftEditor,
  ReviewPanel,
  getApplicationDetail,
} from "@/features/application";
import { daysUntil, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/applications/[id]">): Promise<Metadata> {
  const { id } = await params;
  const application = await getApplicationDetail(id);
  return { title: application?.announcement.title ?? "지원서" };
}

export default async function ApplicationDetailPage({
  params,
}: PageProps<"/applications/[id]">) {
  const { id } = await params;
  const application = await getApplicationDetail(id);
  if (!application) notFound();

  const remaining = daysUntil(application.announcement.endDate);

  return (
    <PageShell
      step={4}
      title={application.announcement.title}
      description={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{application.announcement.source}</Badge>
            {application.announcement.isSample ? <SampleBadge /> : null}
            {application.announcement.region ? (
              <Badge variant="ghost">{application.announcement.region}</Badge>
            ) : null}
            {remaining !== null ? (
              <Badge variant={remaining <= 7 ? "destructive" : "ghost"}>
                {remaining >= 0 ? `D-${remaining}` : "마감"}
              </Badge>
            ) : null}
            {application.similarityAtSave !== null ? (
              <Badge variant="outline">
                유사도 {Math.round(application.similarityAtSave * 100)}%
              </Badge>
            ) : null}
          </div>
          <p>
            {application.announcement.agency
              ? `${application.announcement.agency} · `
              : ""}
            접수 {formatDate(application.announcement.startDate)} ~{" "}
            {formatDate(application.announcement.endDate)} ·{" "}
            {application.announcement.isSample ? (
              // 샘플 공고는 url 이 사이트 루트뿐이라 링크를 걸지 않는다
              <span className="text-muted-foreground">
                원문 없음 (개발용 샘플)
              </span>
            ) : (
              <a
                href={application.announcement.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                원문 보기
              </a>
            )}
          </p>
          <p className="text-xs">
            기준 사업: {application.userBusiness.title} ·{" "}
            <Link href="/business" className="underline underline-offset-4">
              프로필 수정
            </Link>
          </p>
        </div>
      }
      actions={
        <ApplicationStatusControl
          applicationId={application.id}
          status={application.status}
        />
      }
    >
      <AttachmentPanel application={application} />
      <Separator />
      <ReviewPanel application={application} />
      <Separator />
      <DraftEditor application={application} />

      <div className="pt-2">
        <LinkButton variant="outline" size="sm" href="/applications">
          목록으로
        </LinkButton>
      </div>
    </PageShell>
  );
}

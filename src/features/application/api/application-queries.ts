import { asc, desc, eq } from "drizzle-orm";

import {
  announcementAttachments,
  applicationDrafts,
  applicationEligibilityChecks,
  applications,
  db,
} from "@/db";
import { getPrimaryBusiness } from "@/lib/current-user";

export async function listApplications() {
  const business = await getPrimaryBusiness();
  if (!business) return [];

  const rows = await db.query.applications.findMany({
    where: eq(applications.userBusinessId, business.id),
    orderBy: desc(applications.updatedAt),
    with: {
      announcement: {
        columns: {
          id: true,
          title: true,
          source: true,
          url: true,
          agency: true,
          region: true,
          endDate: true,
          isSample: true,
        },
      },
      review: { columns: { fitScore: true, summary: true } },
      // 개수만 필요하지만 관계 조회에 count 가 없어 id 만 얕게 가져온다
      drafts: { columns: { id: true } },
    },
  });

  return rows.map((row) => ({ ...row, draftCount: row.drafts.length }));
}

export type ApplicationListItem = Awaited<
  ReturnType<typeof listApplications>
>[number];

export async function getApplicationDetail(id: string) {
  return db.query.applications.findFirst({
    where: eq(applications.id, id),
    with: {
      announcement: {
        with: {
          // 추출 텍스트가 AI 검토·초안의 근거가 된다
          attachments: { orderBy: asc(announcementAttachments.createdAt) },
        },
      },
      userBusiness: true,
      review: {
        with: {
          checks: { orderBy: asc(applicationEligibilityChecks.order) },
        },
      },
      drafts: { orderBy: asc(applicationDrafts.order) },
    },
  });
}

export type ApplicationDetail = NonNullable<
  Awaited<ReturnType<typeof getApplicationDetail>>
>;

/** 이미 담아둔 공고 id 집합 — 추천/목록 화면에서 "담기" 버튼 상태를 정하는 데 쓴다 */
export async function getSavedAnnouncementIds(): Promise<Set<string>> {
  const business = await getPrimaryBusiness();
  if (!business) return new Set();

  const rows = await db
    .select({ announcementId: applications.announcementId })
    .from(applications)
    .where(eq(applications.userBusinessId, business.id));

  return new Set(rows.map((row) => row.announcementId));
}

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withRuntimeKeys, type RuntimeKeys } from "@/lib/runtime-keys";

import {
  applicationDrafts,
  applicationEligibilityChecks,
  applicationReviews,
  applications,
  db,
  type ApplicationStatus,
} from "@/db";
import { getPrimaryBusiness } from "@/lib/current-user";
import { isAiEnabled } from "@/lib/env";

import { getApplicationDetail } from "./api/application-queries";
import { reviewApplication } from "./api/reviewer";
import { writeDraftSection } from "./api/writer";
import { DRAFT_SECTIONS, getSection } from "./sections";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function revalidateApplication(id?: string) {
  revalidatePath("/applications");
  revalidatePath("/recommendations");
  revalidatePath("/announcements");
  revalidatePath("/");
  if (id) revalidatePath(`/applications/${id}`);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 추천/목록 화면에서 "지원서에 담기" */
export async function saveApplication(input: {
  announcementId: string;
  similarity?: number | null;
}): Promise<ActionResult & { applicationId?: string }> {
  const business = await getPrimaryBusiness();
  if (!business) {
    return { ok: false, error: "먼저 사업 프로필을 등록해 주세요. (STEP 1)" };
  }

  try {
    const [application] = await db
      .insert(applications)
      .values({
        userBusinessId: business.id,
        announcementId: input.announcementId,
        similarityAtSave: input.similarity ?? null,
      })
      // 이미 담아둔 공고면 그대로 두고 id 만 돌려받는다
      .onConflictDoUpdate({
        target: [applications.userBusinessId, applications.announcementId],
        set: { updatedAt: new Date() },
      })
      .returning({ id: applications.id });

    revalidateApplication(application!.id);
    return { ok: true, applicationId: application!.id };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function removeApplication(id: string): Promise<ActionResult> {
  try {
    await db.delete(applications).where(eq(applications.id, id));
    revalidateApplication();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
): Promise<ActionResult> {
  try {
    await db
      .update(applications)
      .set({ status })
      .where(eq(applications.id, id));
    revalidateApplication(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** STEP 4-1: AI 요건 검토 (다시 돌리면 덮어쓴다) */
export async function runReview(
  applicationId: string,
  keys?: RuntimeKeys,
): Promise<ActionResult> {
  return withRuntimeKeys(keys, () => runReviewInner(applicationId));
}

async function runReviewInner(applicationId: string): Promise<ActionResult> {
  if (!isAiEnabled()) {
    return {
      ok: false,
      error:
        "OPENAI_API_KEY 가 없어 AI 검토를 실행할 수 없습니다. .env.local 에 키를 넣어 주세요.",
    };
  }

  try {
    const application = await getApplicationDetail(applicationId);
    if (!application) return { ok: false, error: "지원서를 찾을 수 없습니다." };

    const { payload, model } = await reviewApplication({
      business: {
        title: application.userBusiness.title,
        description: application.userBusiness.description,
        region: application.userBusiness.region,
        category: application.userBusiness.category,
        businessAgeMonth: application.userBusiness.businessAgeMonth,
      },
      announcement: {
        title: application.announcement.title,
        summary: application.announcement.summary,
        content: application.announcement.content,
        agency: application.announcement.agency,
        region: application.announcement.region,
        targetAudience: application.announcement.targetAudience,
        endDate: application.announcement.endDate,
      },
    });

    // 검토는 1건만 유지한다. 체크 항목까지 통째로 교체.
    await db.transaction(async (tx) => {
      await tx
        .delete(applicationReviews)
        .where(eq(applicationReviews.applicationId, applicationId));

      const [review] = await tx
        .insert(applicationReviews)
        .values({
          applicationId,
          fitScore: Math.round(payload.fitScore),
          summary: payload.summary,
          strengths: payload.strengths,
          weaknesses: payload.weaknesses,
          actionItems: payload.actionItems,
          model,
        })
        .returning({ id: applicationReviews.id });

      if (payload.checks.length > 0) {
        await tx.insert(applicationEligibilityChecks).values(
          payload.checks.map((check, index) => ({
            reviewId: review!.id,
            requirement: check.requirement,
            verdict: check.verdict,
            note: check.note || null,
            order: index,
          })),
        );
      }

      await tx
        .update(applications)
        .set({ status: "REVIEWED" })
        .where(eq(applications.id, applicationId));
    });

    revalidateApplication(applicationId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** STEP 4-2: 섹션 초안 생성 (해당 섹션만 덮어쓴다) */
export async function generateDraft(
  applicationId: string,
  sectionKey: string,
  keys?: RuntimeKeys,
): Promise<ActionResult & { content?: string }> {
  return withRuntimeKeys(keys, () =>
    generateDraftInner(applicationId, sectionKey),
  );
}

async function generateDraftInner(
  applicationId: string,
  sectionKey: string,
): Promise<ActionResult & { content?: string }> {
  if (!isAiEnabled()) {
    return {
      ok: false,
      error:
        "OPENAI_API_KEY 가 없어 초안을 생성할 수 없습니다. 직접 작성은 그대로 가능합니다.",
    };
  }

  const section = getSection(sectionKey);
  if (!section) return { ok: false, error: `알 수 없는 섹션: ${sectionKey}` };

  try {
    const application = await getApplicationDetail(applicationId);
    if (!application) return { ok: false, error: "지원서를 찾을 수 없습니다." };

    const { content } = await writeDraftSection({
      section,
      business: {
        title: application.userBusiness.title,
        description: application.userBusiness.description,
        region: application.userBusiness.region,
        category: application.userBusiness.category,
        businessAgeMonth: application.userBusiness.businessAgeMonth,
        keywords: application.userBusiness.keywords,
      },
      announcement: {
        title: application.announcement.title,
        summary: application.announcement.summary,
        content: application.announcement.content,
        agency: application.announcement.agency,
        targetAudience: application.announcement.targetAudience,
      },
      reviewHints: application.review
        ? {
            weaknesses: application.review.weaknesses,
            actionItems: application.review.actionItems,
          }
        : null,
      existingSections: application.drafts
        .filter((draft) => draft.sectionKey !== sectionKey && draft.content)
        .map((draft) => ({ title: draft.title, content: draft.content })),
    });

    await db
      .insert(applicationDrafts)
      .values({
        applicationId,
        sectionKey,
        title: section.title,
        order: section.order,
        content,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [applicationDrafts.applicationId, applicationDrafts.sectionKey],
        set: { content, generatedAt: new Date(), updatedAt: new Date() },
      });

    await db
      .update(applications)
      .set({ status: "WRITING" })
      .where(eq(applications.id, applicationId));

    revalidateApplication(applicationId);
    return { ok: true, content };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** 사용자가 직접 고친 내용 저장 */
export async function saveDraft(
  applicationId: string,
  sectionKey: string,
  content: string,
): Promise<ActionResult> {
  const section = getSection(sectionKey);
  if (!section) return { ok: false, error: `알 수 없는 섹션: ${sectionKey}` };

  try {
    await db
      .insert(applicationDrafts)
      .values({
        applicationId,
        sectionKey,
        title: section.title,
        order: section.order,
        content,
      })
      .onConflictDoUpdate({
        target: [applicationDrafts.applicationId, applicationDrafts.sectionKey],
        set: { content, updatedAt: new Date() },
      });

    revalidateApplication(applicationId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

/** 전체 섹션을 순서대로 생성 — 앞 섹션 내용을 참고하므로 순차 실행한다 */
export async function generateAllDrafts(
  applicationId: string,
  keys?: RuntimeKeys,
): Promise<ActionResult & { generated: number }> {
  return withRuntimeKeys(keys, () => generateAllDraftsInner(applicationId));
}

async function generateAllDraftsInner(
  applicationId: string,
): Promise<ActionResult & { generated: number }> {
  let generated = 0;
  for (const section of DRAFT_SECTIONS) {
    // 이미 withRuntimeKeys 안이므로 키를 다시 넘기지 않아도 컨텍스트가 유지된다
    const result = await generateDraftInner(applicationId, section.key);
    if (!result.ok) {
      return { ok: false, error: result.error, generated };
    }
    generated += 1;
  }
  return { ok: true, generated };
}

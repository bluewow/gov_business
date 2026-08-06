"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withRuntimeKeys, type RuntimeKeys } from "@/lib/runtime-keys";

import {
  announcementAttachments,
  applicationDrafts,
  applicationEligibilityChecks,
  applicationReviews,
  applicationStrategies,
  applications,
  db,
  type ApplicationStatus,
} from "@/db";
import { getPrimaryBusiness } from "@/lib/current-user";
import { isAiEnabled } from "@/lib/env";

import { extractAttachmentsForAnnouncement } from "@/features/ingestion";

import { checkAiReadiness } from "./ai-readiness";
import {
  getApplicationDetail,
  type ApplicationDetail,
} from "./api/application-queries";
import { reviewApplication } from "./api/reviewer";
import { buildStrategy } from "./api/strategist";
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

/**
 * AI 검토·초안에 넘길 첨부 본문.
 *
 * 추출이 끝났고(`PARSED`) 사용자가 켜 둔(`useForAi`) 것만 모은다.
 * 공고문·신청서 양식·체크리스트가 함께 붙는 데다 같은 문서가 hwpx·pdf 로 두 벌
 * 올라오는 일이 흔해서, 전부 넘기면 프롬프트 상한에 걸려 자격요건이 잘려 나간다.
 */
function extractedTexts(application: ApplicationDetail): string[] {
  return application.announcement.attachments
    .filter(
      (item) =>
        item.useForAi && item.parseStatus === "PARSED" && item.extractedText,
    )
    .map((item) => `[첨부: ${item.fileName}]\n${item.extractedText}`);
}

/** AI 입력으로 쓸 첨부인지 켜고 끈다 */
export async function setAttachmentUsage(
  applicationId: string,
  attachmentId: string,
  useForAi: boolean,
): Promise<ActionResult> {
  try {
    await db
      .update(announcementAttachments)
      .set({ useForAi })
      .where(eq(announcementAttachments.id, attachmentId));

    revalidateApplication(applicationId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
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
        "OpenAI API 키가 없어 AI 검토를 실행할 수 없습니다. 사이드바 「설정 → API 키」 에서 입력해 주세요.",
    };
  }

  try {
    const application = await getApplicationDetail(applicationId);
    if (!application) return { ok: false, error: "지원서를 찾을 수 없습니다." };

    // UI 에서 막지만 액션은 직접 호출될 수 있으므로 여기서도 확인한다
    const readiness = checkAiReadiness(application.announcement.attachments);
    if (!readiness.ready) {
      return { ok: false, error: readiness.notice };
    }

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
        attachmentTexts: extractedTexts(application),
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

/**
 * STEP 4-1.5: 합격 전략 수립 (다시 수립하면 덮어쓴다)
 *
 * 요건 검토가 "지원 가능한가"라면 이건 "어떻게 써야 뽑히는가"다.
 * 첨부 공고문(평가기준·배점)이 추출돼 있을수록 정확해지고,
 * 결과의 sectionGuides 는 초안 생성이 그대로 따른다.
 */
export async function runStrategy(
  applicationId: string,
  keys?: RuntimeKeys,
): Promise<ActionResult> {
  return withRuntimeKeys(keys, () => runStrategyInner(applicationId));
}

async function runStrategyInner(applicationId: string): Promise<ActionResult> {
  if (!isAiEnabled()) {
    return {
      ok: false,
      error:
        "OpenAI API 키가 없어 전략을 수립할 수 없습니다. 사이드바 「설정 → API 키」 에서 입력해 주세요.",
    };
  }

  try {
    const application = await getApplicationDetail(applicationId);
    if (!application) return { ok: false, error: "지원서를 찾을 수 없습니다." };

    const { payload, model } = await buildStrategy({
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
        attachmentTexts: extractedTexts(application),
      },
      review: application.review
        ? {
            strengths: application.review.strengths,
            weaknesses: application.review.weaknesses,
          }
        : null,
    });

    await db
      .insert(applicationStrategies)
      .values({
        applicationId,
        positioning: payload.positioning,
        evaluationFocus: payload.evaluationFocus,
        strategyPoints: payload.strategyPoints,
        sectionGuides: payload.sectionGuides,
        model,
      })
      .onConflictDoUpdate({
        target: [applicationStrategies.applicationId],
        set: {
          positioning: payload.positioning,
          evaluationFocus: payload.evaluationFocus,
          strategyPoints: payload.strategyPoints,
          sectionGuides: payload.sectionGuides,
          model,
          updatedAt: new Date(),
        },
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
        "OpenAI API 키가 없어 초안을 생성할 수 없습니다. 사이드바 「설정 → API 키」 에서 입력해 주세요. (직접 작성은 그대로 가능합니다)",
    };
  }

  const section = getSection(sectionKey);
  if (!section) return { ok: false, error: `알 수 없는 섹션: ${sectionKey}` };

  try {
    const application = await getApplicationDetail(applicationId);
    if (!application) return { ok: false, error: "지원서를 찾을 수 없습니다." };

    // UI 에서 막지만 액션은 직접 호출될 수 있으므로 여기서도 확인한다
    const readiness = checkAiReadiness(application.announcement.attachments);
    if (!readiness.ready) {
      return { ok: false, error: readiness.notice };
    }

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
        attachmentTexts: extractedTexts(application),
      },
      reviewHints: application.review
        ? {
            weaknesses: application.review.weaknesses,
            actionItems: application.review.actionItems,
          }
        : null,
      strategy: application.strategy
        ? {
            positioning: application.strategy.positioning,
            sectionGuide:
              application.strategy.sectionGuides[sectionKey] ?? null,
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

/**
 * STEP 4-0: 이 공고의 첨부파일만 내려받아 텍스트를 추출한다.
 *
 * 전체 공고를 일괄 처리하지 않는 이유는 파일 하나가 수백 KB 라서다 —
 * 700건이면 수백 MB 를 정부 서버에서 받아야 하고, 실제로 지원할 공고는 극소수다.
 * 그래서 사용자가 이 화면에서 요청할 때만 그 공고 것만 받는다.
 *
 * 추출한 본문은 AI 요건 검토·초안 작성의 근거로 들어가고,
 * 공고 임베딩도 재생성 대상이 된다(본문이 늘었으므로).
 */
export async function extractApplicationAttachments(
  applicationId: string,
  /** 지정하면 이 첨부만 추출한다. 비우면 전부 */
  attachmentIds?: string[],
): Promise<
  ActionResult & {
    parsed?: number;
    total?: number;
    enrichedFromSource?: boolean;
  }
> {
  try {
    const application = await getApplicationDetail(applicationId);
    if (!application) return { ok: false, error: "지원서를 찾을 수 없습니다." };

    const result = await extractAttachmentsForAnnouncement(
      application.announcementId,
      attachmentIds,
    );

    revalidateApplication(applicationId);

    if (result.total === 0) {
      return {
        ok: false,
        error: application.announcement.sourceUrl
          ? "이 공고와 연결된 원문에서도 첨부파일을 찾지 못했습니다."
          : "이 공고에는 첨부파일이 없습니다.",
      };
    }
    if (result.parsed === 0) {
      return {
        ok: false,
        error: `첨부 ${result.total}건을 모두 읽지 못했습니다 (미지원 ${result.unsupported} · 실패 ${result.failed}). 구형 .hwp 는 아직 지원하지 않습니다.`,
        parsed: 0,
        total: result.total,
      };
    }

    return {
      ok: true,
      parsed: result.parsed,
      total: result.total,
      enrichedFromSource: result.enrichedFromSource,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

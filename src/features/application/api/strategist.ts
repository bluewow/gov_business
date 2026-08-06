import { z } from "zod";

import { env } from "@/lib/env";
import { recordAiUsage } from "@/lib/ai-usage";
import { getOpenAIClient } from "@/lib/openai";
import { truncate } from "@/lib/text";

import { DRAFT_SECTIONS } from "../sections";

/**
 * 합격 전략 수립.
 *
 * 요건 검토(reviewer)가 "지원 가능한가"를 판정한다면, 여기는 "어떻게 써야 뽑히는가"를 뽑는다.
 * 첨부 공고문에 평가기준·배점표가 있는 경우가 많아, 그걸 1차 근거로 삼도록 지시한다.
 * 결과의 sectionGuides 는 초안 생성(writer)이 그대로 따른다 — 전략과 초안이 따로 놀지 않게.
 */

const strategySchema = z.object({
  positioning: z.string().min(1),
  evaluationFocus: z.array(z.string()).default([]),
  strategyPoints: z
    .array(z.object({ title: z.string().min(1), detail: z.string().min(1) }))
    .default([]),
  sectionGuides: z.record(z.string(), z.string()).default({}),
});

export type StrategyPayload = z.infer<typeof strategySchema>;

const SECTION_KEYS = DRAFT_SECTIONS.map((section) => section.key).join(", ");

const SYSTEM_PROMPT = `당신은 정부지원사업 선정 심사에 다수 참여해 본 전략 컨설턴트입니다.
사용자의 사업이 이 공고에서 "선정되기 위해" 무엇을 어떻게 부각해야 하는지 전략을 세우세요.

규칙:
- 공고 본문과 첨부 공고문(평가기준·배점표가 있으면 그것이 1차 근거)에 실제로 적힌 지원 목적·평가 항목에 근거한다. 공고에 없는 심사 기준을 지어내지 않는다.
- evaluationFocus 에는 이 공고의 심사가 실제로 점수를 주는 항목을 적는다. 배점이 명시돼 있으면 "(배점 30점)" 처럼 함께 적는다.
- strategyPoints 는 "이 사업이 이 공고에서 이기는 방법"이다. title 은 한 줄 요약, detail 에는 왜 통하는지와 어떻게 서술할지를 쓴다. 사업의 실제 강점과 공고의 요구가 만나는 지점만 다룬다 — 일반론 금지.
- 사용자의 사업에 없는 사실(실적·수치·인력)을 지어내지 않는다. 부족한 부분은 "무엇을 준비하면 보완되는지"로 쓴다.
- sectionGuides 는 사업계획서 각 섹션(키: ${SECTION_KEYS})을 이 공고에 맞춰 어떻게 쓸지 2~3문장씩 구체적으로 지시한다. 이 가이드대로 초안이 작성된다.
- 모든 문장은 한국어로.

반드시 아래 JSON 형식으로만 답하세요:
{"positioning": "이 공고에 맞춘 사업 포지셔닝 한 문단",
 "evaluationFocus": ["심사가 점수를 주는 항목"],
 "strategyPoints": [{"title": "전략 한 줄", "detail": "왜 통하는지 + 어떻게 서술할지"}],
 "sectionGuides": {"problem": "...", "solution": "...", "scale-up": "...", "team": "..."}}`;

export interface StrategyInput {
  business: {
    title: string;
    description: string;
    region: string | null;
    category: string | null;
    businessAgeMonth: number | null;
    keywords: string[];
  };
  announcement: {
    title: string;
    summary: string | null;
    content: string;
    agency: string | null;
    targetAudience: string | null;
    attachmentTexts?: string[];
  };
  /** 요건 검토 결과 — 약점을 전략에서 선제 보완한다 */
  review?: {
    strengths: string[];
    weaknesses: string[];
  } | null;
}

export async function buildStrategy(
  input: StrategyInput,
): Promise<{ payload: StrategyPayload; model: string }> {
  const openai = getOpenAIClient();
  const model = env.evaluationModel();

  const userPrompt = [
    "## 내 사업",
    `사업명: ${input.business.title}`,
    input.business.region ? `지역: ${input.business.region}` : null,
    input.business.category ? `분야: ${input.business.category}` : null,
    input.business.businessAgeMonth !== null
      ? `업력: ${input.business.businessAgeMonth}개월`
      : null,
    input.business.keywords.length
      ? `키워드: ${input.business.keywords.join(", ")}`
      : null,
    truncate(input.business.description, 3000),
    "",
    "## 공고",
    `제목: ${input.announcement.title}`,
    input.announcement.agency ? `주관: ${input.announcement.agency}` : null,
    input.announcement.targetAudience
      ? `지원대상: ${input.announcement.targetAudience}`
      : null,
    truncate(input.announcement.summary ?? input.announcement.content, 4000),
    ...(input.announcement.attachmentTexts?.length
      ? [
          "",
          "## 공고 첨부파일 본문 (평가기준·배점이 있으면 1차 근거)",
          truncate(input.announcement.attachmentTexts.join("\n\n"), 14000),
        ]
      : []),
    ...(input.review &&
    (input.review.strengths.length || input.review.weaknesses.length)
      ? [
          "",
          "## 요건 검토 결과 (약점은 전략에서 선제 보완할 것)",
          ...input.review.strengths.map((item) => `- 강점: ${item}`),
          ...input.review.weaknesses.map((item) => `- 약점: ${item}`),
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  await recordAiUsage({ feature: "STRATEGY", model, usage: response.usage });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("전략 수립 응답이 비어 있습니다.");
  }

  const parsed = strategySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `전략 수립 응답 형식이 올바르지 않습니다: ${parsed.error.message}`,
    );
  }

  return { payload: parsed.data, model };
}

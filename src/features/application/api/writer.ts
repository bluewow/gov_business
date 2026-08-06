import { env } from "@/lib/env";
import { recordAiUsage } from "@/lib/ai-usage";
import { getOpenAIClient } from "@/lib/openai";
import { truncate } from "@/lib/text";

import type { DraftSection } from "../sections";

const SYSTEM_PROMPT = `당신은 한국 정부지원사업 사업계획서를 다수 작성해 본 컨설턴트입니다.
주어진 사업 정보와 공고에 맞춰 요청된 섹션의 초안을 작성하세요.

규칙:
- 사용자가 제공하지 않은 수치(매출, 투자 유치액, 특허 건수, 고객 수 등)를 지어내지 않는다.
  근거가 필요한 자리는 [예: 2027년까지 월 매출 3,000만원] 처럼 대괄호 placeholder 로 남기고
  사용자가 채우도록 한다.
- 공고의 심사 관점(지원 목적, 지원 대상)에 맞춰 서술한다.
- 문어체 개조식(항목형)으로 쓴다. 소제목 + 불릿 구조를 사용한다.
- 마크다운으로 출력하되 최상위 제목(#)은 쓰지 않는다.
- 분량은 600~900자 내외.
- 한국어로 작성한다.`;

export interface WriteDraftInput {
  section: DraftSection;
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
    /** 첨부파일에서 추출한 본문 */
    attachmentTexts?: string[];
    /**
     * 검토·전략이 첨부 공고문에서 이미 뽑아낸 핵심 (자격요건 판정·평가 관점 등).
     *
     * 이게 있으면 첨부 원문을 대폭 줄여 넣는다. 초안은 섹션마다 호출되는데
     * 매번 같은 공고문 16,000자를 다시 보내면 4섹션에 64,000자가 나가고,
     * 그 내용은 이미 검토·전략 단계에서 한 번 읽고 정리한 것이다.
     */
    brief?: string | null;
  };
  /** AI 검토에서 나온 보완 사항 — 초안에 미리 반영한다 */
  reviewHints?: {
    weaknesses: string[];
    actionItems: string[];
  } | null;
  /** 합격 전략 — 있으면 초안이 이 방향을 그대로 따른다 */
  strategy?: {
    positioning: string;
    /** 이 섹션에 대한 작성 전략 (sectionGuides[section.key]) */
    sectionGuide: string | null;
  } | null;
  /** 이미 작성된 다른 섹션 — 중복 서술을 피하기 위한 참고용 */
  existingSections?: { title: string; content: string }[];
}

export async function writeDraftSection(
  input: WriteDraftInput,
): Promise<{ content: string; model: string }> {
  const openai = getOpenAIClient();
  const model = env.evaluationModel();

  const userPrompt = [
    `## 작성할 섹션\n${input.section.title}\n작성 지침: ${input.section.guide}`,
    "",
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
    "## 지원 공고",
    `제목: ${input.announcement.title}`,
    input.announcement.agency ? `주관: ${input.announcement.agency}` : null,
    input.announcement.targetAudience
      ? `지원대상: ${input.announcement.targetAudience}`
      : null,
    truncate(input.announcement.summary ?? input.announcement.content, 4000),
    ...(input.announcement.brief
      ? [
          "",
          "## 공고 핵심 (AI 검토·전략이 첨부 공고문에서 추출)",
          input.announcement.brief,
        ]
      : []),
    ...(input.announcement.attachmentTexts?.length
      ? [
          "",
          "## 공고 첨부파일 본문(발췌)",
          // 요약이 있으면 원문은 보조 근거로만 쓴다 — 섹션마다 같은 공고문을 통째로
          // 다시 보내면 4섹션에 64,000자가 나간다.
          truncate(
            input.announcement.attachmentTexts.join("\n\n"),
            input.announcement.brief ? 4000 : 16000,
          ),
        ]
      : []),
    input.reviewHints &&
    (input.reviewHints.weaknesses.length ||
      input.reviewHints.actionItems.length)
      ? [
          "",
          "## 사전 검토에서 지적된 보완 사항 (초안에 미리 반영할 것)",
          ...input.reviewHints.weaknesses.map((item) => `- 약점: ${item}`),
          ...input.reviewHints.actionItems.map((item) => `- 보완: ${item}`),
        ].join("\n")
      : null,
    input.existingSections?.length
      ? [
          "",
          "## 이미 작성된 섹션 (내용 중복 금지)",
          ...input.existingSections.map(
            (section) =>
              `### ${section.title}\n${truncate(section.content, 800)}`,
          ),
        ].join("\n")
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.5,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  await recordAiUsage({ feature: "DRAFT", model, usage: response.usage });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("초안 생성 응답이 비어 있습니다.");
  }

  return { content, model };
}

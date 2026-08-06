import { z } from "zod";

import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/openai";
import { truncate } from "@/lib/text";

const reviewSchema = z.object({
  fitScore: z.number().min(0).max(100),
  summary: z.string().min(1),
  checks: z
    .array(
      z.object({
        requirement: z.string().min(1),
        verdict: z.enum(["MET", "UNMET", "UNKNOWN"]),
        note: z.string().default(""),
      }),
    )
    .default([]),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  actionItems: z.array(z.string()).default([]),
});

export type ReviewPayload = z.infer<typeof reviewSchema>;

const SYSTEM_PROMPT = `당신은 한국 정부지원사업 심사·컨설팅 경험이 많은 전문가입니다.
사용자의 사업 정보와 공고를 대조해 "지원해도 되는지"와 "무엇을 보완해야 하는지"를 판정하세요.

규칙:
- checks 에는 공고에서 읽어낸 자격요건을 하나씩 쪼개어 넣는다(업력, 지역, 기업형태, 업종, 연령 등).
- 공고에 근거가 없어 판단할 수 없으면 verdict 는 반드시 UNKNOWN 으로 하고 note 에 무엇을 확인해야 하는지 쓴다. 추측해서 MET 으로 적지 않는다.
- UNMET 이 하나라도 있으면 fitScore 는 40점을 넘지 않는다.
- actionItems 는 사용자가 지금 당장 할 수 있는 행동으로 쓴다(예: "사업자등록증상 업종코드 확인").
- 모든 문장은 한국어로.

업력 해석 (자주 틀리는 부분):
- 업력이 짧은 것은 결격 사유가 아니다. 예비창업자·초기창업기업은 창업지원사업의 주된 대상이다.
- 공고가 요구하는 업력 범위(예비창업자, 창업 후 7년 이내, 3년 미만 등) 안에 들면 verdict 는 MET 이다.
- 공고에 업력 제한이 없거나 지원대상이 "전체" 이면 MET 으로 본다. 대상이 넓은 것은 감점 사유가 아니다.
- UNMET 은 공고가 요구하는 범위를 실제로 벗어날 때만 쓴다(예: 7년 이내 요건에 10년차).
- 충족한 요건을 weaknesses 에 적지 않는다. "업력이 짧음" 은 공고가 장기 업력을 요구할 때만 약점이다.

반드시 아래 JSON 형식으로만 답하세요:
{"fitScore": 0~100 정수,
 "summary": "2~3줄 총평",
 "checks": [{"requirement": "요건", "verdict": "MET|UNMET|UNKNOWN", "note": "근거 또는 확인사항"}],
 "strengths": ["강점"],
 "weaknesses": ["약점"],
 "actionItems": ["보완 행동"]}`;

export interface ReviewInput {
  business: {
    title: string;
    description: string;
    region: string | null;
    category: string | null;
    businessAgeMonth: number | null;
  };
  announcement: {
    title: string;
    summary: string | null;
    content: string;
    agency: string | null;
    region: string | null;
    targetAudience: string | null;
    endDate: Date | null;
    /** 첨부파일에서 추출한 본문 — 자격요건이 여기에만 있는 공고가 많다 */
    attachmentTexts?: string[];
  };
}

export async function reviewApplication(
  input: ReviewInput,
): Promise<{ payload: ReviewPayload; model: string }> {
  const openai = getOpenAIClient();
  const model = env.evaluationModel();

  const userPrompt = [
    "## 내 사업",
    `사업명: ${input.business.title}`,
    input.business.region ? `지역: ${input.business.region}` : null,
    input.business.category ? `분야: ${input.business.category}` : null,
    input.business.businessAgeMonth !== null
      ? `업력: ${input.business.businessAgeMonth}개월`
      : "업력: 미기재",
    "",
    truncate(input.business.description, 3000),
    "",
    "## 공고",
    `제목: ${input.announcement.title}`,
    input.announcement.agency ? `주관: ${input.announcement.agency}` : null,
    input.announcement.region ? `지역: ${input.announcement.region}` : null,
    input.announcement.targetAudience
      ? `지원대상: ${input.announcement.targetAudience}`
      : null,
    input.announcement.endDate
      ? `마감: ${input.announcement.endDate.toISOString().slice(0, 10)}`
      : null,
    "",
    truncate(input.announcement.summary ?? input.announcement.content, 6000),
    ...(input.announcement.attachmentTexts?.length
      ? [
          "",
          "## 공고 첨부파일 본문 (자격요건의 1차 근거)",
          // 공고문 한 편이 3만 자를 넘기도 한다. 앞부분만 남기면 뒤쪽의 자격요건·평가기준이
          // 통째로 잘리므로, 사용자가 첨부를 골라 중복을 걷어내는 만큼 상한도 올려 잡는다.
          truncate(input.announcement.attachmentTexts.join("\n\n"), 24000),
        ]
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("AI 검토 응답이 비어 있습니다.");
  }

  const parsed = reviewSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `AI 검토 응답 형식이 올바르지 않습니다: ${parsed.error.message}`,
    );
  }

  return { payload: parsed.data, model };
}

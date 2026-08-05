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

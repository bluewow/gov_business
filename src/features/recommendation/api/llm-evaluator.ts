import { z } from "zod";

import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/openai";
import { contentHash, truncate } from "@/lib/text";

import type { LlmEvaluation, MatchedAnnouncement } from "../types";

const evaluationSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
});

/**
 * 평가 프롬프트.
 *
 * ⚠️ 업력 해석을 명시하지 않으면 모델이 "업력이 짧다 = 지원 가능성이 낮다" 로 잘못 읽는다.
 * 실제로 그랬다: 지원대상이 「예비창업자 또는 창업 후 7년 이내」인 공고에 업력 1개월인
 * 사용자가 완벽히 해당하는데도 "업력이 1개월로 짧아 지원 가능성이 낮습니다" 로 감점했다.
 * 창업지원사업에서 짧은 업력은 결격이 아니라 오히려 핵심 자격이다.
 *
 * 감점 규칙만 있고 가점 규칙이 없으면 점수가 중간대(70점)로 쏠려 변별이 안 되는 것도
 * 같이 겪었다. 그래서 구간별 기준을 숫자로 못박았다.
 */
const SYSTEM_PROMPT = `당신은 한국 정부지원사업 심사 경험이 많은 컨설턴트입니다.
사용자의 사업 설명과 지원사업 공고를 비교해 실제 지원 가능성과 적합도를 평가하세요.

판단 순서:
1) 지원 대상 요건(업력, 지역, 업종, 기업 형태)에 해당하는가 — 이것을 가장 크게 본다
2) 사업 내용과 공고의 지원 분야가 실질적으로 겹치는가

업력 해석 (자주 틀리는 부분):
- 업력이 짧은 것은 결격 사유가 아니다. 예비창업자·초기창업기업은 창업지원사업의 주된 대상이다
- 공고가 요구하는 업력 범위(예: 예비창업자, 창업 후 7년 이내, 3년 미만) 안에 들면 "충족" 으로 본다
- 업력 제한이 없거나 지원대상이 "전체" 이면 그 항목은 충족으로 본다. 넓은 대상은 감점 사유가 아니다
- 업력 때문에 감점하는 경우는 공고가 요구하는 범위를 실제로 벗어날 때뿐이다 (예: 7년 이내인데 10년차)

점수 기준:
- 85~100: 지원 대상 요건을 모두 충족하고 사업 내용도 공고 취지와 맞는다
- 70~84: 요건은 충족하나 사업 내용이 공고의 핵심 주제와 부분적으로만 겹친다
- 40~69: 요건 충족 여부가 공고문만으로는 불확실하다
- 0~39: 지원 대상이 아니다 (요건을 명확히 벗어난다)
- 요건을 충족했다면 그것을 이유로 감점하지 않는다. 감점은 실제로 대상이 아닐 때만 한다

reason 작성:
- 충족한 요건과 부족한 점을 각각 사실대로 쓴다
- 충족한 항목을 "~지만", "~하나" 같은 역접으로 깎아내리지 않는다

반드시 아래 JSON 형식으로만 답하세요:
{"score": 0~100 정수, "reason": "추천 이유 2줄 이내 한국어 요약"}`;

/**
 * 캐시 무효화 지문 — 모델명 + 프롬프트 해시.
 *
 * 평가 결과는 (모델, 프롬프트) 조합에 종속된다. 모델명만 키로 쓰면 프롬프트를 고쳐도
 * 예전 점수가 그대로 나온다(실제로 업력 오판을 고칠 때 이 함정을 만났다).
 * 프롬프트를 손대면 이 값이 자동으로 바뀌므로 버전을 손으로 올릴 필요가 없다.
 */
export function evaluatorFingerprint(): string {
  return `${env.evaluationModel()}@${contentHash(SYSTEM_PROMPT).slice(0, 8)}`;
}

/** 공고 하나를 LLM 으로 정밀 평가 */
async function evaluateOne(
  businessDescription: string,
  announcement: MatchedAnnouncement,
): Promise<LlmEvaluation | null> {
  const openai = getOpenAIClient();

  const userPrompt = [
    "## 내 사업",
    truncate(businessDescription, 2000),
    "",
    "## 공고",
    `제목: ${announcement.title}`,
    announcement.agency ? `주관: ${announcement.agency}` : null,
    announcement.region ? `지역: ${announcement.region}` : null,
    announcement.targetAudience
      ? `지원대상: ${announcement.targetAudience}`
      : null,
    announcement.endDate
      ? `마감: ${announcement.endDate.toISOString().slice(0, 10)}`
      : null,
    "",
    truncate(announcement.summary ?? announcement.content, 3000),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: env.evaluationModel(),
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;

    const parsed = evaluationSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn("[llm-evaluator] 응답 스키마 불일치", parsed.error.message);
      return null;
    }

    return { score: Math.round(parsed.data.score), reason: parsed.data.reason };
  } catch (error) {
    // 한 건 실패가 전체 추천을 막지 않도록 삼킨다 (유사도 점수로 폴백)
    console.warn(`[llm-evaluator] 평가 실패: ${announcement.id}`, error);
    return null;
  }
}

/**
 * 동시 요청 수 — 레이트리밋과 응답 속도의 절충.
 * 후보가 30건으로 늘면서 4로는 대기가 너무 길어져(8라운드) 8로 올렸다.
 */
const CONCURRENCY = 8;

/**
 * 3차 정밀 평가. 캐시에 없는 건만 넘어온다 (건당 LLM 호출 = 비용).
 * 반환은 announcement.id → 평가 결과 맵.
 */
export async function evaluateAnnouncements(
  businessDescription: string,
  announcements: MatchedAnnouncement[],
): Promise<Map<string, LlmEvaluation>> {
  const results = new Map<string, LlmEvaluation>();
  const queue = [...announcements];

  async function worker() {
    for (;;) {
      const announcement = queue.shift();
      if (!announcement) return;
      const evaluation = await evaluateOne(businessDescription, announcement);
      if (evaluation) results.set(announcement.id, evaluation);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, announcements.length) }, worker),
  );

  return results;
}

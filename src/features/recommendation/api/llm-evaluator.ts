import { z } from "zod";

import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/openai";
import { truncate } from "@/lib/text";

import type { LlmEvaluation, MatchedAnnouncement } from "../types";

const evaluationSchema = z.object({
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
});

const SYSTEM_PROMPT = `당신은 한국 정부지원사업 심사 경험이 많은 컨설턴트입니다.
사용자의 사업 설명과 지원사업 공고를 비교해 실제 지원 가능성과 적합도를 평가하세요.

평가 기준:
- 지원 대상 요건(업력, 지역, 업종, 기업 형태)이 맞는지를 가장 크게 본다
- 사업 내용과 공고의 지원 분야가 실질적으로 겹치는지 본다
- 단어만 비슷하고 실제로는 대상이 아니면 점수를 크게 낮춘다

반드시 아래 JSON 형식으로만 답하세요:
{"score": 0~100 정수, "reason": "추천 이유 2줄 이내 한국어 요약"}`;

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

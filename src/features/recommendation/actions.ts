"use server";

import { getPrimaryBusiness } from "@/lib/current-user";
import { createEmbedding } from "@/lib/embedding";
import { isAiEnabled } from "@/lib/env";
import { withRuntimeKeys, type RuntimeKeys } from "@/lib/runtime-keys";

import { keywordSearchAnnouncements } from "./api/keyword-search";
import { evaluateAnnouncements } from "./api/llm-evaluator";
import {
  matchAnnouncements,
  matchAnnouncementsForBusiness,
} from "./api/vector-search";
import { normalizeKeywords } from "./keywords";
import type {
  KeywordMode,
  MatchedAnnouncement,
  RecommendInput,
  RecommendResult,
  RecommendationItem,
} from "./types";

/** 3차 LLM 평가를 돌릴 상위 건수 — 건당 호출이므로 비용에 직결된다 */
const LLM_EVALUATION_TOP_N = 5;

/** 키워드 없이 훑을 때의 유사도 하한 */
const DEFAULT_THRESHOLD = 0.3;
/** 키워드로 방향을 정한 경우의 하한 — 키워드가 이미 걸러 주므로 낮게 잡는다 */
const KEYWORD_THRESHOLD = 0.1;

/**
 * STEP 3 큐레이션 — 저장된 사업 프로필 + 키워드 기준 추천.
 *
 *   1차: 키워드(제목·본문·분야·지역·지원대상·기관 부분일치) + 모집중 여부를 SQL 로 필터링
 *   2차: 프로필 임베딩과 공고 임베딩의 코사인 유사도 상위 N건 (키워드 적중률로 미세 조정)
 *   3차: 상위 소수 건만 LLM 으로 적합도(0~100) + 이유 산출 (선택)
 *
 * 프로필 임베딩을 재사용하므로 2차까지는 OpenAI 호출이 0회다.
 */
export async function recommendForCurrentBusiness(
  input: RecommendInput = {},
  keys?: RuntimeKeys,
): Promise<RecommendResult> {
  return withRuntimeKeys(keys, () => recommendInner(input));
}

async function recommendInner(
  input: RecommendInput = {},
): Promise<RecommendResult> {
  const keywords = normalizeKeywords(input.keywords);
  const keywordMode: KeywordMode = input.keywordMode ?? "any";

  const business = await getPrimaryBusiness();
  if (!business) {
    return {
      mode: "keyword",
      keywords,
      keywordMode,
      items: [],
      error: "먼저 사업 프로필을 등록해 주세요. (STEP 1)",
    };
  }

  const filter = {
    keywords,
    keywordMode,
    onlyOpen: input.onlyOpen ?? true,
    threshold: keywords.length > 0 ? KEYWORD_THRESHOLD : DEFAULT_THRESHOLD,
    limit: input.limit ?? 10,
  };

  try {
    let matches: MatchedAnnouncement[] = [];
    let mode: RecommendResult["mode"] = "vector";
    let notice: string | undefined;

    if (business.embeddingHash) {
      matches = await matchAnnouncementsForBusiness(business.id, filter);
    } else if (isAiEnabled()) {
      // 프로필 저장 시 임베딩이 만들어지지 않은 경우(키를 나중에 넣은 경우 등)
      const vector = await createEmbedding(business.description);
      matches = await matchAnnouncements(vector, filter);
      notice =
        "사업 프로필에 임베딩이 없어 이번만 즉석 계산했습니다. 프로필을 한 번 저장하면 이후에는 재사용됩니다.";
    } else {
      mode = "keyword";
      matches = await keywordSearchAnnouncements(business.description, filter);
      notice =
        "OPENAI_API_KEY 가 없어 키워드 검색으로 대체했습니다. 의미 기반 추천을 쓰려면 키를 설정하세요.";
    }

    if (matches.length === 0) {
      return {
        mode,
        keywords,
        keywordMode,
        items: [],
        notice: [notice, emptyNotice(keywords, keywordMode)]
          .filter(Boolean)
          .join(" "),
      };
    }

    if (!input.useLlm || mode === "keyword") {
      return {
        mode,
        keywords,
        keywordMode,
        items: matches.map(toItem),
        notice,
      };
    }

    const evaluations = await evaluateAnnouncements(
      business.description,
      matches.slice(0, LLM_EVALUATION_TOP_N),
    );

    const items = matches
      .map((match) => {
        const evaluation = evaluations.get(match.id);
        return {
          ...toItem(match),
          llmScore: evaluation?.score ?? null,
          llmReason: evaluation?.reason ?? null,
        };
      })
      // LLM 점수가 있으면 그것을 우선, 없으면 유사도로 정렬
      .sort((a, b) => rank(b) - rank(a));

    return { mode, keywords, keywordMode, items, notice };
  } catch (error) {
    return {
      mode: "vector",
      keywords,
      keywordMode,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 결과가 0건일 때 다음에 무엇을 바꾸면 되는지 알려준다 */
function emptyNotice(keywords: string[], keywordMode: KeywordMode): string {
  if (keywords.length === 0) {
    return "조건에 맞는 공고가 없습니다. STEP 2 에서 공고를 수집하거나 키워드를 넣어 다시 찾아보세요.";
  }
  if (keywords.length > 1 && keywordMode === "all") {
    return `「${keywords.join(" + ")}」 를 모두 포함하는 공고가 없습니다. 「하나라도 포함」 으로 바꾸거나 키워드를 줄여 보세요.`;
  }
  return `「${keywords.join(", ")}」 로는 맞는 공고가 없습니다. 키워드를 더 넓은 말로 바꿔 보세요.`;
}

function toItem(match: Omit<RecommendationItem, "llmScore" | "llmReason">) {
  return { ...match, llmScore: null, llmReason: null };
}

function rank(item: RecommendationItem): number {
  return item.llmScore !== null ? item.llmScore : item.similarity * 100;
}

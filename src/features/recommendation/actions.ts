"use server";

import { eq } from "drizzle-orm";

import { db, userBusinesses } from "@/db";
import { buildEmbeddingSource } from "@/features/business";
import { getPrimaryBusiness } from "@/lib/current-user";
import { createEmbedding } from "@/lib/embedding";
import { isAiEnabled } from "@/lib/env";
import { withRuntimeKeys, type RuntimeKeys } from "@/lib/runtime-keys";
import { contentHash } from "@/lib/text";

import { keywordSearchAnnouncements } from "./api/keyword-search";
import {
  businessHashOf,
  getCachedEvaluations,
  saveEvaluations,
} from "./api/evaluation-cache";
import {
  evaluateAnnouncements,
  evaluatorFingerprint,
} from "./api/llm-evaluator";
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

/**
 * LLM 평가에 넘길 후보 건수.
 *
 * 예전엔 유사도 상위 5건만 물어봤는데, 그 "상위 5건" 을 뽑는 유사도가 변별력이 없다.
 * 실측: 모집중 469건 중 119건이 0.45~0.55 구간에 몰려 있고, 1위(0.545)와 33위(0.497)의
 * 차이가 0.048 뿐이다. 이 좁은 띠 안에서 순위는 사실상 노이즈라, 정작 자격이 맞는 공고가
 * 33위에 있어도 LLM 근처에 못 갔다.
 *
 * 그래서 유사도는 "명백히 무관한 것만 쳐내는" 1차 체로만 쓰고, 진짜 판단(업력·지역·업종
 * 요건 충족 여부)은 LLM 이 이 건수만큼 본다. 재조회는 캐시가 받아 주므로 새 공고가
 * 들어올 때만 호출이 늘어난다.
 */
const LLM_EVALUATION_CANDIDATES = 30;

/**
 * 유사도 하한.
 *
 * 예전엔 키워드 유무에 따라 0.3 / 0.1 을 썼는데, 0.3 은 한국어 공고에서 너무 높아
 * 의미가 가까운 공고까지 조용히 잘라냈다. 순위를 정하는 건 상위 N 정렬이고
 * 이 값은 "아무것도 안 맞을 때 쓰레기를 보여주지 않는" 안전장치로만 둔다.
 */
const SIMILARITY_THRESHOLD = 0.15;

/**
 * STEP 3 큐레이션 — 저장된 사업 프로필 + 키워드 기준 추천.
 *
 *   1차: 모집중 여부로 거른 뒤, 키워드 갈래와 의미 갈래를 각각 유사도 순으로 뽑는다
 *   2차: 두 갈래를 번갈아 합치고 중복 공고를 접는다 (키워드는 게이트가 아니라 힌트)
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

  // 화면에 보여줄 건수와 후보 건수를 나눈다.
  // LLM 을 쓸 때는 넓게 뽑아 평가하고, 그 점수로 다시 줄여서 보여준다.
  const displayLimit = input.limit ?? 10;
  const filter = {
    keywords,
    keywordMode,
    onlyOpen: input.onlyOpen ?? true,
    threshold: SIMILARITY_THRESHOLD,
    limit: input.useLlm
      ? Math.max(displayLimit, LLM_EVALUATION_CANDIDATES)
      : displayLimit,
  };

  try {
    let matches: MatchedAnnouncement[] = [];
    let mode: RecommendResult["mode"] = "vector";
    let notice: string | undefined;

    if (business.embeddingHash) {
      matches = await matchAnnouncementsForBusiness(business.id, filter);
    } else if (isAiEnabled()) {
      // 프로필 저장 시 임베딩이 만들어지지 않은 경우(키를 나중에 넣은 경우 등).
      // 저장 경로와 같은 원문을 써야 한다 — description 만 넣으면 분야·지역·업력이 빠져
      // 나중에 저장될 벡터와 달라지고, 해시도 어긋나 매번 다시 계산하게 된다.
      const source = buildEmbeddingSource({
        title: business.title,
        description: business.description,
        region: business.region,
        category: business.category,
        businessAgeMonth: business.businessAgeMonth,
        keywords: business.keywords,
      });
      const vector = await createEmbedding(source);

      // 계산한 김에 저장해 둔다 — 안 그러면 조회할 때마다 같은 값을 다시 결제한다
      await db
        .update(userBusinesses)
        .set({ embedding: vector, embeddingHash: contentHash(source) })
        .where(eq(userBusinesses.id, business.id));

      matches = await matchAnnouncements(vector, filter);
      notice =
        "사업 프로필 임베딩을 이번에 만들어 저장했습니다. 다음부터는 바로 재사용됩니다.";
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
        notice: [notice, emptyNotice()].filter(Boolean).join(" "),
      };
    }

    if (!input.useLlm || mode === "keyword") {
      // 키워드 폴백은 LLM 을 못 쓰므로, 넓게 잡아 둔 후보를 표시 건수로 되돌린다
      return {
        mode,
        keywords,
        keywordMode,
        items: matches.slice(0, displayLimit).map(toItem),
        notice,
      };
    }

    // 후보 전체를 LLM 에 물어보되, 이미 평가한 조합은 캐시에서 꺼낸다.
    // (키워드만 바꿔 재검색하는 패턴이 잦아 캐시가 없으면 같은 값을 반복 결제하게 된다)
    const targets = matches.slice(0, LLM_EVALUATION_CANDIDATES);
    // 모델명이 아니라 (모델 + 프롬프트) 지문을 캐시 키로 쓴다 — 프롬프트를 고치면 자동 재평가
    const model = evaluatorFingerprint();

    // 설명만 넘기면 업력·지역·분야가 빠져 자격 판정이 부실해진다.
    // 임베딩과 같은 원문을 써서 프롬프트와 캐시 키를 한 곳에서 맞춘다.
    const businessProfile = buildEmbeddingSource({
      title: business.title,
      description: business.description,
      region: business.region,
      category: business.category,
      businessAgeMonth: business.businessAgeMonth,
      keywords: business.keywords,
    });
    const businessHash = businessHashOf(businessProfile);

    const cached = await getCachedEvaluations({
      userBusinessId: business.id,
      businessHash,
      model,
      announcements: targets,
    });

    const misses = targets.filter((item) => !cached.has(item.id));
    const fresh = await evaluateAnnouncements(businessProfile, misses);

    await saveEvaluations({
      userBusinessId: business.id,
      businessHash,
      model,
      entries: misses
        .map((announcement) => {
          const evaluation = fresh.get(announcement.id);
          return evaluation ? { announcement, evaluation } : null;
        })
        .filter((entry) => entry !== null),
    });

    const evaluations = new Map([...cached, ...fresh]);

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
      .sort((a, b) => rank(b) - rank(a))
      // 넓게 평가하고 좁게 보여준다 — 후보 30건 중 점수 상위만 남긴다
      .slice(0, displayLimit);

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

/**
 * 결과가 0건일 때 다음에 무엇을 바꾸면 되는지 알려준다.
 * 키워드는 후보를 걸러내지 않으므로(하이브리드), 0건은 "키워드가 좁아서" 가 아니라
 * 임베딩된 공고 자체가 없거나 전부 유사도 하한 아래라는 뜻이다.
 */
function emptyNotice(): string {
  return "내 사업과 가까운 공고를 찾지 못했습니다. STEP 2 에서 공고를 더 수집하거나, 임베딩이 끝났는지 확인해 보세요.";
}

function toItem(match: Omit<RecommendationItem, "llmScore" | "llmReason">) {
  return { ...match, llmScore: null, llmReason: null };
}

function rank(item: RecommendationItem): number {
  return item.llmScore !== null ? item.llmScore : item.similarity * 100;
}

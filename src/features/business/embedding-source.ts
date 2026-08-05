import { normalizeWhitespace } from "@/lib/text";

/**
 * 임베딩 원문 조립 — 추천 품질은 이 문장 구성에 좌우된다.
 *
 * `actions.ts` 는 `"use server"` 파일이라 **export 가 전부 async 함수여야** 한다.
 * 이 순수 함수를 거기 두면 빌드가 "Server Actions must be async functions" 로 깨진다.
 * 프로필 저장(business)과 즉석 계산(recommendation) 양쪽이 같은 원문을 써야
 * 벡터와 해시가 어긋나지 않으므로 공용 모듈로 뺐다.
 */
export interface BusinessEmbeddingInput {
  title: string;
  description: string;
  region?: string | null;
  category?: string | null;
  businessAgeMonth?: number | null;
  keywords?: string[] | null;
}

export function buildEmbeddingSource(input: BusinessEmbeddingInput): string {
  return normalizeWhitespace(
    [
      input.title,
      input.category ? `분야: ${input.category}` : null,
      input.region ? `지역: ${input.region}` : null,
      input.businessAgeMonth !== null && input.businessAgeMonth !== undefined
        ? `업력: ${input.businessAgeMonth}개월`
        : null,
      input.keywords?.length ? `키워드: ${input.keywords.join(", ")}` : null,
      input.description,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

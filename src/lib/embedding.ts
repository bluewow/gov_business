import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { env } from "@/lib/env";
import { getOpenAIClient } from "@/lib/openai";
import { normalizeWhitespace, truncate } from "@/lib/text";

export { EMBEDDING_DIMENSIONS };

/**
 * 모델 입력 상한(8191 토큰)에 대한 보수적인 문자 수 상한.
 * 한글은 토큰당 1~2자 수준이라 8000자면 대체로 안전하다.
 */
const MAX_INPUT_CHARS = 8000;

/** 한 번의 API 호출에 넣을 최대 개수 */
const BATCH_SIZE = 96;

export function prepareEmbeddingInput(text: string): string {
  return truncate(normalizeWhitespace(text), MAX_INPUT_CHARS);
}

export async function createEmbedding(text: string): Promise<number[]> {
  const [vector] = await createEmbeddings([text]);
  if (!vector) {
    throw new Error("임베딩 생성에 실패했습니다 (빈 응답).");
  }
  return vector;
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const openai = getOpenAIClient();
  const model = env.embeddingModel();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(prepareEmbeddingInput);
    const response = await openai.embeddings.create({ model, input: batch });

    // API 는 index 순서를 보장하지 않으므로 명시적으로 정렬한다.
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `임베딩 차원이 ${item.embedding.length} 입니다. 스키마는 ${EMBEDDING_DIMENSIONS} 차원을 기대합니다 — ` +
            `모델(${model})을 바꿨다면 src/db/schema.ts 의 EMBEDDING_DIMENSIONS 도 함께 바꿔야 합니다.`,
        );
      }
      results.push(item.embedding);
    }
  }

  return results;
}

import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { env } from "@/lib/env";
import { recordAiUsage } from "@/lib/ai-usage";
import { getOpenAIClient } from "@/lib/openai";
import { normalizeWhitespace, truncate } from "@/lib/text";

export { EMBEDDING_DIMENSIONS };

/**
 * 모델 입력 상한(8,192 토큰)에 대한 보수적인 문자 수 상한.
 *
 * cl100k 계열 토크나이저에서 한글은 **글자당 1~2 토큰**이다 (자주 헷갈리는 방향인데,
 * "토큰당 1~2자"가 아니다). 8000자로 잡았다가 첨부 공고문이 병합된 긴 원문에서
 * `maximum input length is 8192 tokens` 400 이 실제로 났다.
 * 4000자면 글자당 2토큰으로 잡아도 ~8000토큰이라 한도 안이다.
 */
const MAX_INPUT_CHARS = 4000;

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

function isInputTooLongError(error: unknown): boolean {
  return error instanceof Error && /maximum input length/i.test(error.message);
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(prepareEmbeddingInput);
    results.push(...(await embedBatch(batch)));
  }

  return results;
}

/**
 * 배치 하나를 임베딩한다. 길이 초과 400 이 나면 입력을 반으로 줄여 재시도한다.
 *
 * 4000자 상한으로도 부족한 경우가 있다 — PDF 추출물에 폰트 매핑이 깨진
 * 문자(mojibake)가 섞이면 글자당 3토큰까지 나오기 때문. 한 항목 때문에
 * 배치 전체(최대 96건)가 죽는 것을 막는 안전망이다.
 */
async function embedBatch(batch: string[]): Promise<number[][]> {
  const openai = getOpenAIClient();
  const model = env.embeddingModel();

  let inputs = batch;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await openai.embeddings.create({ model, input: inputs });
      await recordAiUsage({
        feature: "EMBEDDING",
        model,
        usage: response.usage,
        items: inputs.length,
      });

      // API 는 index 순서를 보장하지 않으므로 명시적으로 정렬한다.
      const sorted = [...response.data].sort((a, b) => a.index - b.index);
      return sorted.map((item) => {
        if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `임베딩 차원이 ${item.embedding.length} 입니다. 스키마는 ${EMBEDDING_DIMENSIONS} 차원을 기대합니다 — ` +
              `모델(${model})을 바꿨다면 src/db/schema.ts 의 EMBEDDING_DIMENSIONS 도 함께 바꿔야 합니다.`,
          );
        }
        return item.embedding;
      });
    } catch (error) {
      // 절반씩 두 번(→ 1/4)까지 줄여 본다. 그래도 넘치면 진짜 이상한 입력이다.
      if (!isInputTooLongError(error) || attempt >= 2) throw error;

      const nextLimit = Math.floor(MAX_INPUT_CHARS / 2 ** (attempt + 1));
      console.warn(
        `[embedding] 입력이 토큰 한도를 넘어 ${nextLimit}자로 줄여 재시도합니다.`,
      );
      inputs = inputs.map((text) => truncate(text, nextLimit));
    }
  }
}

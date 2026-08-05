import OpenAI from "openai";

import { env } from "@/lib/env";

let cached: { key: string; client: OpenAI } | null = null;

/**
 * OPENAI_API_KEY 가 없으면 여기서 명확한 에러를 던진다.
 *
 * 키를 함께 캐시하는 이유: 브라우저에서 넣은 휘발성 키는 요청마다 달라질 수 있는데,
 * 클라이언트만 캐시하면 처음 들어온 키를 계속 재사용해 엉뚱한 계정으로 호출하게 된다.
 */
export function getOpenAIClient(): OpenAI {
  const apiKey = env.requireOpenaiApiKey();

  if (cached?.key !== apiKey) {
    cached = { key: apiKey, client: new OpenAI({ apiKey }) };
  }
  return cached.client;
}

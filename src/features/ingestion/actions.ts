"use server";

import { revalidatePath } from "next/cache";

import { isAiEnabled } from "@/lib/env";
import { withRuntimeKeys, type RuntimeKeys } from "@/lib/runtime-keys";

import type { AnnouncementSource } from "@/db";

import {
  embedPendingAnnouncements,
  getAdapter,
  ingestAll,
  ingestSource,
} from "./ingest";
import type { IngestionResult } from "./types";

function revalidateAll() {
  revalidatePath("/ingestion");
  revalidatePath("/announcements");
  revalidatePath("/recommendations");
  revalidatePath("/");
}

/** 수집 현황 화면의 "지금 수집" 버튼 */
export async function runIngestion(
  source?: AnnouncementSource,
  keys?: RuntimeKeys,
): Promise<IngestionResult[]> {
  return withRuntimeKeys(keys, async () => {
    const results = source
      ? await (async () => {
          const adapter = getAdapter(source);
          if (!adapter) {
            return [
              {
                source,
                fetched: 0,
                created: 0,
                updated: 0,
                embedded: 0,
                error: `알 수 없는 source: ${source}`,
              } satisfies IngestionResult,
            ];
          }
          return [await ingestSource(adapter)];
        })()
      : await ingestAll();

    revalidateAll();
    return results;
  });
}

/** 아직 임베딩되지 않은 공고만 처리 */
export async function runEmbedding(keys?: RuntimeKeys): Promise<{
  embedded: number;
  error?: string;
}> {
  return withRuntimeKeys(keys, async () => {
    // 키가 없으면 조용히 0 을 돌려주는 대신 사유를 알린다.
    // (embedPendingAnnouncements 는 키가 없으면 그냥 0 을 반환한다)
    if (!isAiEnabled()) {
      return {
        embedded: 0,
        error:
          "OpenAI API 키가 없어 임베딩을 만들 수 없습니다. 사이드바 「설정 → API 키」 에서 입력해 주세요.",
      };
    }

    try {
      const embedded = await embedPendingAnnouncements();
      revalidateAll();
      return { embedded };
    } catch (error) {
      return {
        embedded: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

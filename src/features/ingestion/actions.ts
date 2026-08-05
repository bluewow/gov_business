"use server";

import { revalidatePath } from "next/cache";

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

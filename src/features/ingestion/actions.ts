"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { isAiEnabled } from "@/lib/env";
import { withRuntimeKeys, type RuntimeKeys } from "@/lib/runtime-keys";

import type { AnnouncementSource } from "@/db";

import {
  acquireEmbeddingLock,
  acquireIngestLock,
  adapters,
  embedPendingWithoutLock,
  ingestSourceWithoutLock,
} from "./ingest";

function revalidateAll() {
  revalidatePath("/ingestion");
  revalidatePath("/announcements");
  revalidatePath("/recommendations");
  revalidatePath("/");
}

/**
 * 수집 현황 화면의 "지금 수집" 버튼 — 백그라운드로 시작한다.
 *
 * 예전에는 수집이 끝날 때까지 기다렸는데, 페이지를 옮기거나 dev 서버가 재컴파일되면
 * 요청이 죽어 ingestion_runs 에 RUNNING 이 영영 남았다. 임베딩과 같은 방식으로
 * 잠금을 응답 전에 잡고 after() 에 작업을 넘긴다. 결과는 실행 이력에서 확인한다.
 *
 * 첨부 다운로드(skipAttachments)는 하지 않는다 — 첨부는 지원서 상세에서
 * 사용자가 요청할 때만 받기로 한 설계를 따른다.
 */
export async function runIngestion(
  source?: AnnouncementSource,
  keys?: RuntimeKeys,
): Promise<{ started: boolean; error?: string }> {
  const targets = source
    ? adapters.filter((a) => a.source === source)
    : adapters;
  if (source && targets.length === 0) {
    return { started: false, error: `알 수 없는 source: ${source}` };
  }

  const lock = await acquireIngestLock();
  if (!lock) {
    return { started: false, error: "이미 수집이 진행 중입니다." };
  }

  after(async () => {
    try {
      // after 콜백은 요청 컨텍스트 밖에서 돌 수 있으므로 키를 다시 실어 준다
      await withRuntimeKeys(keys, async () => {
        for (const adapter of targets) {
          const result = await ingestSourceWithoutLock(adapter, {
            skipAttachments: true,
          });
          console.info(
            `[ingest] ${adapter.source} 완료 — 수집 ${result.fetched} · 신규 ${result.created} · 갱신 ${result.updated} · 임베딩 ${result.embedded}${result.error ? ` · 오류: ${result.error}` : ""}`,
          );
        }
      });
    } catch (error) {
      console.error("[ingest] 백그라운드 수집 실패", error);
    } finally {
      await lock.release();
      revalidateAll();
    }
  });

  return { started: true };
}

/** 한 번의 백그라운드 실행에서 처리할 최대 건수 */
const BACKGROUND_EMBED_LIMIT = 1000;

/**
 * 임베딩을 백그라운드로 시작한다.
 *
 * 예전에는 서버 액션이 끝날 때까지 기다렸다가 결과를 돌려줬는데,
 * 임베딩이 오래 걸려서 사용자가 페이지를 옮기면 요청이 끊기고 작업도 중단됐다.
 * 이제 응답을 먼저 보내고 `after()` 로 계속 돌린다 — 화면을 떠나도 끝까지 진행된다.
 *
 * 잠금은 응답 **전에** 잡는다. 그래야 곧바로 새로고침해도 화면이 「진행 중」을 볼 수 있고,
 * 작업이 끝나 잠금이 풀리면 화면의 폴링도 자연히 멈춘다.
 */
export async function runEmbedding(keys?: RuntimeKeys): Promise<{
  started: boolean;
  error?: string;
}> {
  return withRuntimeKeys(keys, async () => {
    if (!isAiEnabled()) {
      return {
        started: false,
        error:
          "OpenAI API 키가 없어 임베딩을 만들 수 없습니다. 사이드바 「설정 → API 키」 에서 입력해 주세요.",
      };
    }

    const lock = await acquireEmbeddingLock();
    if (!lock) {
      return { started: false, error: "이미 임베딩이 진행 중입니다." };
    }

    after(async () => {
      try {
        // after 콜백은 요청 컨텍스트 밖에서 돌 수 있으므로 키를 다시 실어 준다
        const embedded = await withRuntimeKeys(keys, () =>
          embedPendingWithoutLock(BACKGROUND_EMBED_LIMIT),
        );
        console.info(`[embed] 백그라운드 임베딩 ${embedded}건 완료`);
      } catch (error) {
        console.error("[embed] 백그라운드 임베딩 실패", error);
      } finally {
        await lock.release();
      }
    });

    return { started: true };
  });
}

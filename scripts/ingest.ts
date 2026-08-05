// 반드시 첫 번째 import — db 모듈보다 먼저 평가돼야 DATABASE_URL 이 채워진다
import "../src/db/load-env";

import type { AnnouncementSource } from "../src/db/schema";
import {
  adapters,
  embedPendingAnnouncements,
  getAdapter,
  ingestAll,
  ingestSource,
} from "../src/features/ingestion/ingest";
import { db } from "../src/db";

/**
 * 공고 수집 CLI.
 *
 *   pnpm ingest                              # 모든 소스 수집
 *   pnpm ingest --source=K_STARTUP           # 특정 소스만
 *   pnpm ingest --source=EGBIZ --dry-run     # DB 에 쓰지 않고 파싱 결과만 확인
 *   pnpm ingest --max-pages=10               # 초기 적재 시 페이지 확대
 *   pnpm ingest --embed-only                 # 수집 없이 미임베딩 공고만 처리
 */
function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    flags.set(key!, value ?? "true");
  }
  return {
    source: flags.get("source") as AnnouncementSource | undefined,
    dryRun: flags.has("dry-run"),
    embedOnly: flags.has("embed-only"),
    skipEmbedding: flags.has("skip-embedding"),
    skipAttachments: flags.has("skip-attachments"),
    maxPages: flags.has("max-pages")
      ? Number(flags.get("max-pages"))
      : undefined,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.embedOnly) {
    const embedded = await embedPendingAnnouncements();
    console.info(`✓ 임베딩 ${embedded}건 생성`);
    return;
  }

  const ingestOptions = {
    dryRun: options.dryRun,
    skipEmbedding: options.skipEmbedding,
    skipAttachments: options.skipAttachments,
    maxPages: options.maxPages,
  };

  if (options.source) {
    const adapter = getAdapter(options.source);
    if (!adapter) {
      throw new Error(
        `알 수 없는 source: ${options.source}. 사용 가능: ${adapters
          .map((item) => item.source)
          .join(", ")}`,
      );
    }
    console.table([await ingestSource(adapter, ingestOptions)]);
    return;
  }

  console.table(await ingestAll(ingestOptions));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // pg Pool 이 열려 있으면 프로세스가 끝나지 않는다.
    // process.exit() 로 끊으면 libuv 가 정리 중인 핸들을 만나 assertion 으로 죽으므로
    // 풀을 정상 종료시켜 이벤트 루프를 비운다.
    await db.$client.end();
  });

import { config as loadEnv } from "dotenv";

/**
 * CLI 스크립트(seed, ingest)용 env 로더.
 *
 * ESM 은 import 를 모듈 본문보다 먼저 평가하므로, 스크립트 본문에서 dotenv 를 부르면
 * 이미 `src/db/index.ts` 가 평가된 뒤라 DATABASE_URL 이 비어 있다.
 * 그래서 스크립트에서는 반드시 이 모듈을 **첫 번째 import** 로 둔다.
 *
 * Next.js 는 .env.local 을 자동으로 읽으므로 앱 경로에는 필요 없다.
 */
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

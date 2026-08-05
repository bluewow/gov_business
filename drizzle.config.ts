import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js 는 .env.local 을 자동으로 읽지만 drizzle-kit 은 읽지 않는다.
// 로컬 값이 한 곳(.env.local)에만 있도록 여기서 직접 로드한다.
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // src/db/index.ts 의 drizzle({ casing }) 와 반드시 같아야 한다
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // pgvector / pg_trgm 은 docker initdb 에서 설치한다.
  // drizzle-kit 이 확장 소유 객체를 지우려 들지 않도록 알려 준다.
  extensionsFilters: ["postgis"],
  verbose: true,
  strict: true,
});

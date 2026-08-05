import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * Drizzle 클라이언트.
 *
 * connectionString 을 여기서 검증하지 않는 이유: 빌드 시점에 DB 가 없어도 모듈 import 만으로는
 * 죽지 않아야 하기 때문. 실제 쿼리 시점에 에러가 난다.
 *
 * casing: "snake_case" — 스키마의 camelCase 프로퍼티를 DB 의 snake_case 컬럼으로 매핑한다.
 * drizzle.config.ts 에도 같은 값이 있어야 마이그레이션이 어긋나지 않는다.
 */
function createDb() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: process.env.NODE_ENV === "production" ? 10 : 5,
  });

  return drizzle({ client: pool, schema, casing: "snake_case" });
}

const globalForDb = globalThis as unknown as {
  db?: ReturnType<typeof createDb>;
  dbSchema?: typeof schema;
};

/**
 * dev 의 HMR 이 매 요청마다 새 커넥션 풀을 만드는 것을 막되,
 * schema.ts 가 새로 로드됐다면(= 컬럼 추가 등) 클라이언트도 다시 만든다.
 *
 * 캐시된 클라이언트는 예전 테이블 객체로 컬럼명 매핑을 잡아 두기 때문에, 그대로 두면
 * 새로 추가한 컬럼을 쓸 때 `Cannot read properties of undefined (reading 'replace')` 로 터진다.
 * (실제로 is_sample 컬럼을 추가했을 때 dev 서버만 이 에러가 났다)
 */
if (process.env.NODE_ENV !== "production" && globalForDb.dbSchema !== schema) {
  void globalForDb.db?.$client.end().catch(() => {});
  globalForDb.db = undefined;
}

export const db = globalForDb.db ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
  globalForDb.dbSchema = schema;
}

export * from "./schema";

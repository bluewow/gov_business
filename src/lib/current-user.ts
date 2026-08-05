import { desc, eq } from "drizzle-orm";

import { db, userBusinesses, users } from "@/db";

/**
 * 인증이 아직 없다. 모든 화면이 이 데모 계정 하나를 공유한다.
 * 로그인을 붙일 때 이 두 함수만 세션에서 사용자를 읽도록 바꾸면 나머지는 그대로 동작한다.
 */
const DEMO_EMAIL = "demo@example.com";

export async function getCurrentUser() {
  // 항상 행을 돌려받기 위해 onConflictDoUpdate 로 upsert 한다
  const [user] = await db
    .insert(users)
    .values({ email: DEMO_EMAIL, name: "데모 사용자" })
    .onConflictDoUpdate({ target: users.email, set: { email: DEMO_EMAIL } })
    .returning();

  return user!;
}

/** 추천·지원서의 기준이 되는 사업 프로필. 아직 등록 전이면 undefined. */
export async function getPrimaryBusiness() {
  const user = await getCurrentUser();

  return db.query.userBusinesses.findFirst({
    where: eq(userBusinesses.userId, user.id),
    orderBy: desc(userBusinesses.updatedAt),
  });
}

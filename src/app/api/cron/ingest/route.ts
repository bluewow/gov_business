import { NextResponse } from "next/server";

import { announcementSourceEnum, type AnnouncementSource } from "@/db/schema";
import { env } from "@/lib/env";
import { getAdapter, ingestAll, ingestSource } from "@/features/ingestion";

// 스크레이핑/임베딩은 오래 걸린다. Vercel 배포 시 플랜에 맞춰 조정할 것.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * 공고 수집 배치.
 *
 * Vercel Cron 등록 예 (vercel.json):
 *   { "crons": [{ "path": "/api/cron/ingest", "schedule": "0 19 * * *" }] }
 *   → 매일 04:00 KST (Vercel Cron 은 UTC 기준)
 *
 * 인증: CRON_SECRET 이 설정되어 있으면 Authorization: Bearer <CRON_SECRET> 필요.
 */
export async function GET(request: Request) {
  const secret = env.cronSecret();
  if (secret) {
    const authorization = request.headers.get("authorization");
    if (authorization !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const sourceParam = url.searchParams.get("source");

  try {
    if (sourceParam) {
      const source = sourceParam as AnnouncementSource;
      const adapter = getAdapter(source);
      if (!adapter) {
        return NextResponse.json(
          {
            error: `알 수 없는 source: ${sourceParam}`,
            available: announcementSourceEnum.enumValues,
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ results: [await ingestSource(adapter)] });
    }

    return NextResponse.json({ results: await ingestAll() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

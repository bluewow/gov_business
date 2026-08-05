// 반드시 첫 번째 import — db 모듈보다 먼저 평가돼야 DATABASE_URL 이 채워진다
import "./load-env";

import { and, eq } from "drizzle-orm";

import {
  announcements,
  applications,
  db,
  userBusinesses,
  users,
} from "./index";
import { embedPendingAnnouncements } from "../features/ingestion/ingest";
import { isAiEnabled } from "../lib/env";

const DEMO_BUSINESS_ID = "00000000-0000-0000-0000-000000000001";

/** 개발용 샘플 공고. 실제 수집은 `pnpm ingest` 가 담당한다. */
const SAMPLE_ANNOUNCEMENTS = [
  {
    source: "K_STARTUP" as const,
    externalId: "sample-1",
    title: "2026년 예비창업패키지 예비창업자 모집공고",
    content:
      "혁신적인 기술창업 아이디어를 보유한 예비창업자를 대상으로 사업화 자금(최대 1억원), 창업교육, 전담 멘토링을 지원합니다. 신청자격은 공고일 기준 사업자등록을 하지 않은 예비창업자이며, AI·빅데이터·SaaS 등 기술 기반 아이템을 우대합니다.",
    url: "https://www.k-startup.go.kr/",
    category: "창업",
    region: null,
    targetAudience: "예비창업자 (사업자등록 이력 없음)",
    agency: "중소벤처기업부",
    daysFromNow: 30,
  },
  {
    source: "K_STARTUP" as const,
    externalId: "sample-2",
    title: "초기창업패키지 창업기업 모집공고",
    content:
      "업력 3년 이내 창업기업의 시제품 제작, 지식재산권 확보, 마케팅 등 사업화를 지원합니다. 최대 1억원의 사업화 자금과 특화 프로그램을 제공하며 소프트웨어·플랫폼 서비스 기업의 참여가 많습니다.",
    url: "https://www.k-startup.go.kr/",
    category: "창업",
    region: null,
    targetAudience: "업력 3년 이내 창업기업",
    agency: "중소벤처기업부",
    daysFromNow: 21,
  },
  {
    source: "EGBIZ" as const,
    externalId: "sample-3",
    title: "경기도 소상공인 디지털 전환 지원사업",
    content:
      "경기도 내 소상공인의 매장 운영 디지털화를 지원합니다. POS·재고관리·매출분석 등 스마트 상점 솔루션 도입 비용의 70%(최대 500만원)를 보조하며, 도입 이후 컨설팅도 함께 제공합니다.",
    url: "https://www.egbiz.or.kr/",
    category: "소상공인",
    region: "경기",
    targetAudience: "경기도 소재 소상공인",
    agency: "경기도경제과학진흥원",
    daysFromNow: 14,
  },
  {
    source: "EGBIZ" as const,
    externalId: "sample-4",
    title: "중소기업 AI 솔루션 도입 바우처 지원사업",
    content:
      "제조·유통 중소기업이 AI 기반 수요예측, 재고 최적화, 품질검사 솔루션을 도입할 때 바우처 형태로 최대 7천만원을 지원합니다. 공급기업으로 등록된 SaaS 기업의 솔루션을 선택할 수 있습니다.",
    url: "https://www.egbiz.or.kr/",
    category: "R&D",
    region: null,
    targetAudience: "중소기업 (제조·유통)",
    agency: "정보통신산업진흥원",
    daysFromNow: 45,
  },
  {
    source: "BIZINFO" as const,
    externalId: "sample-5",
    title: "수출바우처 사업 참여기업 모집",
    content:
      "해외 진출을 준비하는 중소·중견기업에 통·번역, 해외 인증, 온라인 마케팅, 전시회 참가 비용을 바우처로 지원합니다. 전년도 수출 실적에 따라 지원 한도가 달라집니다.",
    url: "https://www.bizinfo.go.kr/",
    category: "수출",
    region: null,
    targetAudience: "중소·중견기업",
    agency: "KOTRA",
    daysFromNow: 10,
  },
  {
    source: "BIZINFO" as const,
    externalId: "sample-6",
    title: "청년창업사관학교 입교생 모집",
    content:
      "만 39세 이하 청년 창업자를 대상으로 사업화 자금, 창업 공간, 코칭을 일괄 지원합니다. 업력 3년 미만 기업이 대상이며 제조·기술 기반 아이템을 우선 선발합니다.",
    url: "https://www.k-startup.go.kr/",
    category: "창업",
    region: null,
    targetAudience: "만 39세 이하 · 업력 3년 미만",
    agency: "중소벤처기업진흥공단",
    daysFromNow: 7,
  },
];

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  const [user] = await db
    .insert(users)
    .values({ email: "demo@example.com", name: "데모 사용자" })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: "데모 사용자" },
    })
    .returning();

  await db
    .insert(userBusinesses)
    .values({
      id: DEMO_BUSINESS_ID,
      userId: user!.id,
      title: "AI 매장 관리 SaaS",
      description:
        "소상공인 대상 AI 매장 관리 SaaS 를 개발 중입니다. 매출·재고 데이터를 자동 분석해 발주량을 추천하고, POS 와 연동해 일 단위 리포트를 제공합니다. 경기도 성남 소재 예비창업자입니다.",
      region: "경기",
      category: "창업",
      businessAgeMonth: 0,
      keywords: ["AI", "SaaS", "소상공인", "재고관리"],
    })
    .onConflictDoNothing({ target: userBusinesses.id });

  for (const sample of SAMPLE_ANNOUNCEMENTS) {
    const { daysFromNow: offset, ...rest } = sample;
    await db
      .insert(announcements)
      .values({
        ...rest,
        summary: sample.content.slice(0, 200),
        startDate: daysFromNow(-7),
        endDate: daysFromNow(offset),
        isSample: true,
      })
      // 이미 들어있는 행도 샘플 표시가 붙도록 갱신한다
      .onConflictDoUpdate({
        target: [announcements.source, announcements.externalId],
        set: { isSample: true },
      });
  }

  // STEP 4 화면을 바로 열어볼 수 있도록 지원서 1건을 담아둔 상태로 만든다
  const [sampleAnnouncement] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.source, "EGBIZ"),
        eq(announcements.externalId, "sample-3"),
      ),
    );

  if (sampleAnnouncement) {
    await db
      .insert(applications)
      .values({
        userBusinessId: DEMO_BUSINESS_ID,
        announcementId: sampleAnnouncement.id,
        similarityAtSave: 0.72,
      })
      .onConflictDoNothing({
        target: [applications.userBusinessId, applications.announcementId],
      });
  }

  console.info(
    `✓ 사용자 1명 / 사업 1건 / 공고 ${SAMPLE_ANNOUNCEMENTS.length}건 / 지원서 1건 시드 완료`,
  );

  if (isAiEnabled()) {
    const embedded = await embedPendingAnnouncements();
    console.info(`✓ 공고 임베딩 ${embedded}건 생성`);
  } else {
    console.info(
      "· OPENAI_API_KEY 가 없어 임베딩을 건너뜁니다. 키를 넣고 `pnpm db:embed` 를 실행하세요.",
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    // 풀을 닫아야 프로세스가 정상 종료된다 (process.exit 은 libuv assertion 을 유발)
    await db.$client.end();
  });

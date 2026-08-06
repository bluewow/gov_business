import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * 컬럼/테이블 이름은 drizzle.config.ts 와 src/db/index.ts 의 casing: "snake_case" 로
 * 자동 변환된다 (embeddingHash → embedding_hash). 새 컬럼을 추가할 때 별도 이름을 적지 않는다.
 */

/** text-embedding-3-small 차원 수 — 아래 vector() 정의와 반드시 일치해야 한다 */
export const EMBEDDING_DIMENSIONS = 1536;

// ── enums ──────────────────────────────────────────────────────

export const announcementSourceEnum = pgEnum("announcement_source", [
  "K_STARTUP",
  "EGBIZ",
  "BIZINFO",
]);

export const parseStatusEnum = pgEnum("parse_status", [
  "PENDING",
  "PARSED",
  "UNSUPPORTED",
  "FAILED",
]);

export const ingestionStatusEnum = pgEnum("ingestion_status", [
  "RUNNING",
  "SUCCESS",
  "FAILED",
]);

/** 지원서 진행 단계 — 사이드바 4단계 흐름의 마지막 구간 */
export const applicationStatusEnum = pgEnum("application_status", [
  "SAVED",
  "REVIEWED",
  "WRITING",
  "SUBMITTED",
  "ARCHIVED",
]);

/** 요건 충족 여부 판정 */
export const eligibilityVerdictEnum = pgEnum("eligibility_verdict", [
  "MET",
  "UNMET",
  "UNKNOWN",
]);

/** 토큰을 쓰는 기능 — 어디서 얼마나 나갔는지 나누는 기준 */
export const aiFeatureEnum = pgEnum("ai_feature", [
  "EMBEDDING",
  "EVALUATION",
  "REVIEW",
  "STRATEGY",
  "DRAFT",
]);

export type AnnouncementSource =
  (typeof announcementSourceEnum.enumValues)[number];
export type ParseStatus = (typeof parseStatusEnum.enumValues)[number];
export type IngestionStatus = (typeof ingestionStatusEnum.enumValues)[number];
export type ApplicationStatus =
  (typeof applicationStatusEnum.enumValues)[number];
export type EligibilityVerdict =
  (typeof eligibilityVerdictEnum.enumValues)[number];

// ── 공통 컬럼 ──────────────────────────────────────────────────

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const emptyTextArray = sql`'{}'::text[]`;

// ── tables ─────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text(),
  ...timestamps,
});

/** 사용자가 등록한 사업 아이템(프로필). 이 설명이 추천의 기준 벡터가 된다. */
export const userBusinesses = pgTable(
  "user_businesses",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    title: text().notNull(),
    /** 사업 내용 상세 설명 — 임베딩 원문 */
    description: text().notNull(),

    /** 1차 필터링용 조건 */
    region: text(),
    category: text(),
    /** 업력(개월). 예비창업자는 0 */
    businessAgeMonth: integer(),
    keywords: text().array().notNull().default(emptyTextArray),

    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    /** 임베딩 원문의 SHA-256 — 값이 같으면 재임베딩을 건너뛴다 */
    embeddingHash: text(),

    ...timestamps,
  },
  (table) => [index("user_businesses_user_id_idx").on(table.userId)],
);

/** 수집된 지원사업 공고 */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid().primaryKey().defaultRandom(),
    source: announcementSourceEnum().notNull(),
    /** 원본 시스템의 공고 ID (source 와 조합해 유일) */
    externalId: text().notNull(),

    title: text().notNull(),
    /** 공고 본문 — 임베딩 원문의 일부 */
    content: text().notNull(),
    /** LLM 평가에 넣는 짧은 요약 */
    summary: text(),
    url: text().notNull(),
    /**
     * 공고가 가리키는 원문 링크(egbiz 의 「관련사이트」 등).
     * egbiz 는 본문·첨부 없이 기업마당 공고를 링크만 걸어 두는 경우가 많아,
     * 첨부 추출 시 이 주소를 따라가 실제 공고문을 찾는다.
     */
    sourceUrl: text(),

    category: text(),
    region: text(),
    /** 지원 대상 원문 */
    targetAudience: text(),
    /** 주관 기관 */
    agency: text(),
    startDate: timestamp({ withTimezone: true }),
    endDate: timestamp({ withTimezone: true }),

    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    embeddingHash: text(),

    /**
     * seed 로 넣은 개발용 가짜 공고. 실제 수집 공고와 화면에서 구분하기 위한 표시다.
     * url 이 사이트 루트라 「원문 보기」가 의미 없으므로 UI 에서 링크를 막는다.
     */
    isSample: boolean().notNull().default(false),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("announcements_source_external_id_key").on(
      table.source,
      table.externalId,
    ),
    index("announcements_end_date_idx").on(table.endDate),
    index("announcements_region_category_idx").on(table.region, table.category),
    // 코사인 유사도 검색용. cosineDistance() 오름차순 정렬일 때만 이 인덱스를 탄다.
    index("announcements_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    // 제목 부분일치 (OPENAI_API_KEY 가 없을 때의 키워드 폴백 경로)
    index("announcements_title_trgm_idx").using(
      "gin",
      table.title.op("gin_trgm_ops"),
    ),
  ],
);

/** 공고 첨부파일(HWP/PDF). 본문이 첨부에만 있는 공고가 많아 별도 추출 레이어를 둔다. */
export const announcementAttachments = pgTable(
  "announcement_attachments",
  {
    id: uuid().primaryKey().defaultRandom(),
    announcementId: uuid()
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),

    fileName: text().notNull(),
    fileUrl: text().notNull(),
    mimeType: text(),

    /** 파서가 뽑아낸 텍스트 — 임베딩 원문에 합쳐진다 */
    extractedText: text(),
    parseStatus: parseStatusEnum().notNull().default("PENDING"),
    parseError: text(),

    /**
     * AI 요건 검토·초안 작성의 입력으로 쓸지 여부.
     *
     * 공고 하나에 공고문·신청서 양식·체크리스트가 같이 붙고, 같은 문서가 hwpx·pdf 로
     * 두 벌 올라오는 일도 흔하다. 전부 프롬프트에 밀어 넣으면 상한에 걸려 정작 필요한
     * 자격요건이 잘려 나가므로, 사용자가 넘길 것을 고를 수 있게 한다.
     */
    useForAi: boolean().notNull().default(true),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("announcement_attachments_announcement_id_file_url_key").on(
      table.announcementId,
      table.fileUrl,
    ),
    index("announcement_attachments_parse_status_idx").on(table.parseStatus),
  ],
);

/** 사용자가 "이 공고에 지원해 보겠다"고 담아둔 건. AI 검토·작성의 작업 단위. */
export const applications = pgTable(
  "applications",
  {
    id: uuid().primaryKey().defaultRandom(),
    userBusinessId: uuid()
      .notNull()
      .references(() => userBusinesses.id, { onDelete: "cascade" }),
    announcementId: uuid()
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),

    status: applicationStatusEnum().notNull().default("SAVED"),
    memo: text(),
    /** 담을 당시의 코사인 유사도 (추천 화면에서 넘어온 경우) */
    similarityAtSave: doublePrecision(),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("applications_user_business_id_announcement_id_key").on(
      table.userBusinessId,
      table.announcementId,
    ),
    index("applications_status_updated_at_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

/** AI 요건 검토 결과 (지원서당 1건, 다시 돌리면 덮어쓴다) */
export const applicationReviews = pgTable("application_reviews", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid()
    .notNull()
    .unique()
    .references(() => applications.id, { onDelete: "cascade" }),

  /** 종합 적합도 0~100 */
  fitScore: integer().notNull(),
  /** 2~3줄 총평 */
  summary: text().notNull(),

  strengths: text().array().notNull().default(emptyTextArray),
  weaknesses: text().array().notNull().default(emptyTextArray),
  actionItems: text().array().notNull().default(emptyTextArray),

  /** 검토에 사용한 모델 — 재현/디버깅용 */
  model: text().notNull(),
  ...timestamps,
});

/** 공고의 개별 자격요건에 대한 판정 */
export const applicationEligibilityChecks = pgTable(
  "application_eligibility_checks",
  {
    id: uuid().primaryKey().defaultRandom(),
    reviewId: uuid()
      .notNull()
      .references(() => applicationReviews.id, { onDelete: "cascade" }),

    requirement: text().notNull(),
    verdict: eligibilityVerdictEnum().notNull().default("UNKNOWN"),
    note: text(),
    order: integer().notNull().default(0),
  },
  (table) => [
    index("application_eligibility_checks_review_id_order_idx").on(
      table.reviewId,
      table.order,
    ),
  ],
);

/** 사업계획서 섹션별 초안. 사용자가 직접 수정할 수 있고 섹션 단위로 재생성한다. */
export const applicationDrafts = pgTable(
  "application_drafts",
  {
    id: uuid().primaryKey().defaultRandom(),
    applicationId: uuid()
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),

    /** PSST 등 표준 목차 키 — src/features/application/sections.ts 참고 */
    sectionKey: text().notNull(),
    title: text().notNull(),
    content: text().notNull().default(""),
    order: integer().notNull().default(0),

    /** AI 가 생성한 시점. 사용자가 직접 고치면 그대로 두고 updatedAt 만 갱신된다. */
    generatedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("application_drafts_application_id_section_key_key").on(
      table.applicationId,
      table.sectionKey,
    ),
    index("application_drafts_application_id_order_idx").on(
      table.applicationId,
      table.order,
    ),
  ],
);

/**
 * LLM 정밀 평가 결과 캐시.
 *
 * 같은 사업 × 같은 공고를 다시 평가하면 같은 답이 나오는데 매번 호출하면 비용만 나간다.
 * 사업 설명이나 공고 내용이 실제로 바뀌었을 때만 다시 부르도록,
 * 평가 당시의 임베딩 해시를 함께 저장해 두고 값이 다르면 캐시를 무시한다.
 */
export const llmEvaluations = pgTable(
  "llm_evaluations",
  {
    id: uuid().primaryKey().defaultRandom(),
    userBusinessId: uuid()
      .notNull()
      .references(() => userBusinesses.id, { onDelete: "cascade" }),
    announcementId: uuid()
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),

    /** 적합도 0~100 */
    score: integer().notNull(),
    /** 추천 이유 2줄 요약 */
    reason: text().notNull(),

    /** 평가 시점의 원문 해시 — 하나라도 다르면 캐시 무효 */
    businessHash: text().notNull(),
    announcementHash: text().notNull(),
    /** 사용한 모델 — 모델을 바꾸면 캐시를 새로 채운다 */
    model: text().notNull(),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("llm_evaluations_business_announcement_key").on(
      table.userBusinessId,
      table.announcementId,
    ),
  ],
);

/** 전략 포인트 하나 — 무엇을(title) 왜·어떻게(detail) */
export interface StrategyPoint {
  title: string;
  detail: string;
}

/**
 * 합격 전략 (지원서당 1건, 다시 수립하면 덮어쓴다).
 *
 * 요건 검토가 "지원 가능한가"를 답한다면, 이건 "어떻게 써야 뽑히는가"를 답한다.
 * 공고(특히 첨부 공고문의 평가기준·배점)를 근거로 내 사업의 포지셔닝과
 * 섹션별 작성 전략을 뽑아 두고, 초안 생성이 이를 그대로 따른다.
 */
export const applicationStrategies = pgTable("application_strategies", {
  id: uuid().primaryKey().defaultRandom(),
  applicationId: uuid()
    .notNull()
    .unique()
    .references(() => applications.id, { onDelete: "cascade" }),

  /** 이 공고에 맞춘 내 사업의 포지셔닝 — 한 문단 */
  positioning: text().notNull(),
  /** 공고·심사가 중요하게 보는 것 (평가기준에서 추출) */
  evaluationFocus: text().array().notNull().default(emptyTextArray),
  /** 따내기 위한 전략 포인트 */
  strategyPoints: jsonb().$type<StrategyPoint[]>().notNull().default([]),
  /** PSST 섹션 키 → 그 섹션을 어떻게 쓸지 (초안 생성이 그대로 따른다) */
  sectionGuides: jsonb().$type<Record<string, string>>().notNull().default({}),

  /** 수립에 사용한 모델 — 재현/디버깅용 */
  model: text().notNull(),
  ...timestamps,
});

/** 수집 실행 기록 — 실패·0건 수집을 화면에서 확인하기 위한 것 */
/**
 * OpenAI 호출 1건의 토큰 사용량.
 *
 * 응답에 `usage` 가 늘 들어오는데 그동안 전부 버리고 있었다. 그래서 "어느 기능이
 * 얼마나 쓰는지" 를 대시보드 밖에서는 알 수 없었고, 절감 논의도 전부 추정이었다.
 * 기록 실패가 본 기능을 막으면 안 되므로 쓰기는 항상 best-effort 다.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid().primaryKey().defaultRandom(),
    feature: aiFeatureEnum().notNull(),
    model: text().notNull(),

    promptTokens: integer().notNull().default(0),
    completionTokens: integer().notNull().default(0),
    totalTokens: integer().notNull().default(0),

    /** 이 호출 한 번이 처리한 건수 — 임베딩은 배치라 1행에 여러 건이 담긴다 */
    items: integer().notNull().default(1),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_usage_feature_created_at_idx").on(table.feature, table.createdAt),
  ],
);

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    source: announcementSourceEnum().notNull(),
    status: ingestionStatusEnum().notNull().default("RUNNING"),

    fetchedCount: integer().notNull().default(0),
    createdCount: integer().notNull().default(0),
    updatedCount: integer().notNull().default(0),
    embeddedCount: integer().notNull().default(0),

    error: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("ingestion_runs_source_started_at_idx").on(
      table.source,
      table.startedAt,
    ),
  ],
);

// ── relations (db.query.*.findMany({ with }) 용) ────────────────

export const usersRelations = relations(users, ({ many }) => ({
  businesses: many(userBusinesses),
}));

export const userBusinessesRelations = relations(
  userBusinesses,
  ({ one, many }) => ({
    user: one(users, {
      fields: [userBusinesses.userId],
      references: [users.id],
    }),
    applications: many(applications),
  }),
);

export const announcementsRelations = relations(announcements, ({ many }) => ({
  attachments: many(announcementAttachments),
  applications: many(applications),
}));

export const announcementAttachmentsRelations = relations(
  announcementAttachments,
  ({ one }) => ({
    announcement: one(announcements, {
      fields: [announcementAttachments.announcementId],
      references: [announcements.id],
    }),
  }),
);

export const applicationsRelations = relations(
  applications,
  ({ one, many }) => ({
    userBusiness: one(userBusinesses, {
      fields: [applications.userBusinessId],
      references: [userBusinesses.id],
    }),
    announcement: one(announcements, {
      fields: [applications.announcementId],
      references: [announcements.id],
    }),
    review: one(applicationReviews, {
      fields: [applications.id],
      references: [applicationReviews.applicationId],
    }),
    strategy: one(applicationStrategies, {
      fields: [applications.id],
      references: [applicationStrategies.applicationId],
    }),
    drafts: many(applicationDrafts),
  }),
);

export const applicationStrategiesRelations = relations(
  applicationStrategies,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationStrategies.applicationId],
      references: [applications.id],
    }),
  }),
);

export const applicationReviewsRelations = relations(
  applicationReviews,
  ({ one, many }) => ({
    application: one(applications, {
      fields: [applicationReviews.applicationId],
      references: [applications.id],
    }),
    checks: many(applicationEligibilityChecks),
  }),
);

export const applicationEligibilityChecksRelations = relations(
  applicationEligibilityChecks,
  ({ one }) => ({
    review: one(applicationReviews, {
      fields: [applicationEligibilityChecks.reviewId],
      references: [applicationReviews.id],
    }),
  }),
);

export const llmEvaluationsRelations = relations(llmEvaluations, ({ one }) => ({
  userBusiness: one(userBusinesses, {
    fields: [llmEvaluations.userBusinessId],
    references: [userBusinesses.id],
  }),
  announcement: one(announcements, {
    fields: [llmEvaluations.announcementId],
    references: [announcements.id],
  }),
}));

export const applicationDraftsRelations = relations(
  applicationDrafts,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationDrafts.applicationId],
      references: [applications.id],
    }),
  }),
);

// ── row 타입 ───────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type UserBusiness = typeof userBusinesses.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type AnnouncementAttachment =
  typeof announcementAttachments.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type ApplicationReview = typeof applicationReviews.$inferSelect;
export type ApplicationStrategy = typeof applicationStrategies.$inferSelect;
export type ApplicationDraft = typeof applicationDrafts.$inferSelect;
export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type LlmEvaluation = typeof llmEvaluations.$inferSelect;

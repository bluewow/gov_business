@AGENTS.md

# web — 정부지원사업 큐레이터

지원사업 공고를 수집해 내 사업과의 연관도를 분석하고, 선택한 공고의 자격요건 검토와
사업계획서 초안 작성까지 이어지는 서비스.

## 사용자 흐름 = 사이드바 구조

화면 구성이 곧 진행 순서다. 새 화면을 추가할 때 이 4단계 중 어디에 속하는지부터 정한다.
네비게이션 정의는 [nav-items.ts](src/components/layout/nav-items.ts) 한 곳에 있다.

| 단계   | 화면                        | 하는 일                                             |
| ------ | --------------------------- | --------------------------------------------------- |
| 개요   | `/` 대시보드                | 4단계 진행 현황, 다음에 할 일 안내                  |
| STEP 1 | `/business` 사업 프로필     | 사업 설명 등록 → 저장 시 임베딩 생성                |
| STEP 2 | `/ingestion` 수집 현황      | 소스별 상태, 수동 수집, 임베딩 진행률, 실행 이력    |
|        | `/announcements` 공고 목록  | 제목 검색 · 마감여부/정렬 필터 · 바로 지원서로 담기 |
| STEP 3 | `/recommendations` 큐레이션 | 키워드 + 프로필 임베딩 기준 추천 → 담기             |
| STEP 4 | `/applications` 지원 관리   | 담아둔 공고 목록 · 진행 상태                        |
|        | `/applications/[id]` 상세   | AI 요건 검토 + 사업계획서 섹션별 초안 생성/편집     |

## 아키텍처

```
[공고 수집: K-Startup API / 기업마당·egbiz 스크레이퍼]  src/features/ingestion/sources/
              ↓
[첨부파일(HWP·PDF) 텍스트 추출]                    src/features/ingestion/attachment-parser.ts
              ↓
[전처리 & 저장]                                    Drizzle → PostgreSQL 17 + pgvector (Docker)
              ↓
[임베딩 생성]  text-embedding-3-small (1536d)      src/lib/embedding.ts
              ↓
[추천 3단계]                                       src/features/recommendation/
  1차 하이브리드 후보 (모집중)     ─┐ 키워드 갈래 + 의미 갈래를 번갈아 합친다
  2차 코사인 유사도 (pgvector)     ─┤ cosineDistance() + HNSW  ← api/vector-search.ts
     + 중복 접기 (제목·마감일)      ─┤ api/dedupe.ts
  3차 LLM 정밀 평가 (후보 30건)    ─┘ gpt-4o-mini → {score, reason} → 상위 10건 표시
              ↓
[지원서]                                           src/features/application/
  AI 요건 검토   reviewer.ts → {fitScore, checks[], strengths, weaknesses, actionItems}
  초안 작성      writer.ts   → PSST 4개 섹션 (문제인식/실현가능성/성장전략/팀)
              ↓
[Next.js App Router UI + Server Action]            src/app/, src/features/*/components/
```

핵심 설계 결정:

- **DB 는 Docker 로 로컬 관리** — `pgvector/pgvector:pg17`. Supabase 없이도 pgvector 가 그대로 동작한다.
- **ORM 은 Drizzle** — pgvector 를 1급으로 다룬다. `vector()` 컬럼, `cosineDistance()`, HNSW 인덱스가 전부 스키마/쿼리로 표현된다. (Prisma 에서 옮겨온 이유는 아래 "왜 Drizzle 인가" 참고)
- **프로필 임베딩을 저장해 재사용** — 추천 조회 자체는 OpenAI 호출이 0회다. LLM 은 3차 평가와 지원서 검토·작성에서만 쓴다.
- **키워드는 게이트가 아니라 힌트 (하이브리드 검색)** — 지역/분야 필터 대신 키워드를 쓰되, **키워드를 SQL 하드 필터로만 쓰면 안 된다.** 실제로 그렇게 만들었다가, 문자열이 하나도 안 걸리는 공고는 벡터 검색이 보지도 못한 채 잘려 나가는 사고가 났다(모집중 475건 중 66건만 후보로 남았고, 사용자가 원하던 공고는 유사도가 아무리 높아도 탈락). 어휘가 달라도 의미로 찾으라고 임베딩을 쓰는 건데 그 앞에 문자열 게이트를 세우면 자기모순이다. 그래서 [api/vector-search.ts](src/features/recommendation/api/vector-search.ts) 는 두 갈래를 각각 뽑아 **번갈아 합친다**: `lexical`(키워드 통과분 중 유사도 상위) + `semantic`(키워드 무시 유사도 상위). 점수로 한 줄 세우면 한쪽이 다른 쪽을 밀어내므로 순번을 번갈아 준다. 결과 카드는 `matchedBy` 로 「#키워드」/「의미 유사」를 구분해 보여준다. 키워드 정규화·추출은 [keywords.ts](src/features/recommendation/keywords.ts)(순수 함수 — 클라이언트에서도 import 가능), SQL 조건은 [api/keyword-filter.ts](src/features/recommendation/api/keyword-filter.ts).
- **유사도는 후보를 넓히는 체, 순위는 LLM 이 정한다** — 코사인 유사도만으로는 "이 공고의 지원대상에 내가 해당하는가"를 표현하지 못한다. 실측: 모집중 469건 중 119건이 0.45~0.55 구간에 몰리고 1위(0.545)와 33위(0.497)의 차이가 0.048뿐이라, 그 띠 안에서 순위는 노이즈에 가깝다. 그래서 유사도 상위 5건만 LLM 에 물어보던 구조에서는 자격이 맞는 공고가 33위에 있어도 평가 근처에 못 갔다. 지금은 **유사도로 후보 30건을 뽑아 전부 LLM 에 물어보고, 그 점수로 다시 줄여 10건을 보여준다**(`LLM_EVALUATION_CANDIDATES`). 표시 건수(`displayLimit`)와 후보 건수를 분리한 이유가 이것이다. 재조회는 `llm_evaluations` 캐시가 받아 주므로 새 공고가 들어올 때만 호출이 는다. LLM 에 넘기는 사업 요약은 `buildEmbeddingSource()` 로 만들어 **업력·지역·분야가 프롬프트에 반드시 들어가게** 한다 — 설명만 넘기면 자격 판정이 부실해지고, 캐시 키(`businessHash`)도 이 텍스트 기준이라 프롬프트와 한 곳에서 맞춰진다.
- **평가 캐시 키는 모델명이 아니라 (모델 + 프롬프트) 지문** — 평가 결과는 프롬프트에 종속된다. 모델명만 키로 쓰면 프롬프트를 고쳐도 예전 점수가 그대로 나온다. [llm-evaluator.ts](src/features/recommendation/api/llm-evaluator.ts) 의 `evaluatorFingerprint()` 가 `모델명@프롬프트해시8자` 를 만들어 주므로 프롬프트를 손대면 자동으로 재평가된다 — 버전을 손으로 올릴 필요가 없다.
- **평가 프롬프트는 업력 해석을 명시해야 한다** — 안 그러면 모델이 "업력이 짧다 = 지원 가능성이 낮다" 로 잘못 읽는다. 실제로 지원대상이 「예비창업자 또는 창업 후 7년 이내」인 공고에 업력 1개월 사용자가 완벽히 해당하는데도 "업력이 1개월로 짧아 지원 가능성이 낮습니다" 로 감점했다. 창업지원사업에서 짧은 업력은 결격이 아니라 핵심 자격이다. 감점 규칙만 있고 가점 규칙·구간 기준이 없으면 점수가 70점대로 쏠려 변별이 안 되는 것도 같이 겪었다.
- **같은 공고가 소스별로 중복 수집된다** — 기업마당 공고가 egbiz 에도 실리는 식으로, 실측 전체의 약 19%(제목 47개 × 2건)가 중복이다. 그대로 두면 추천 10칸 중 여러 칸을 같은 공고가 먹는다. [api/dedupe.ts](src/features/recommendation/api/dedupe.ts) 가 `(제목, 마감일)` 로 묶어 접고, 접힌 출처는 `duplicateSources` 에 남겨 카드에 `BIZINFO · EGBIZ` 로 병기한다. 제목만으로 묶으면 해마다 같은 이름으로 나오는 공고까지 뭉치므로 마감일을 같이 쓴다. **공고 목록(`/announcements`)에는 아직 이 처리가 없다.**
- **OPENAI_API_KEY 가 없으면 키워드 검색으로 폴백** — DB·UI 개발이 API 키 없이도 가능하다. AI 검토·작성은 키가 있어야 동작하며, 없으면 화면에 사유를 표시한다.
- **인증 없음** — [current-user.ts](src/lib/current-user.ts) 가 데모 계정 하나를 공유한다. 로그인을 붙일 때 이 파일만 바꾸면 된다.
- **수집은 수동 실행만** — 자동 스케줄러도, 이를 위한 HTTP 엔드포인트도 두지 않는다. 유료 API 가 모르는 사이에 도는 것을 막기 위한 의도적인 제약이다. 나중에 자동화가 필요해지면 `ingestAll()` 을 호출하는 진입점을 새로 만들되, 비용이 새지 않는지부터 확인할 것.
- **수집 깊이는 "아는 공고를 만나면 멈춤"으로 자동 조절** — `ingestSource()` 가 해당 소스의 기존 `external_id` 를 모아 `FetchOptions.knownExternalIds` 로 넘긴다. 이건 **필터가 아니라 멈춤 신호**다: 목록이 최신순인 소스에서 한 페이지가 통째로 기존 공고면 그 뒤도 전부 기존 공고이므로 거기서 중단한다. 첫 수집(빈 집합)은 `maxPages` 까지 훑고, 이후 정기 수집은 1~2페이지에서 끝난다. 아는 공고도 결과에 담아 다시 upsert 하므로 마감일 변경 같은 갱신은 놓치지 않는다. 목록 뒤쪽에 빠진 공고를 메우려면 `--full`(멈춤 신호 해제). 현재 기업마당만 이 신호를 쓴다.

### 왜 Drizzle 인가 (Prisma → Drizzle 이전 기록)

Prisma 로 시작했다가 pgvector 때문에 옮겼다. 다시 Prisma 를 검토할 일이 있으면 아래를 먼저 볼 것.

| 항목                | Prisma                                                   | Drizzle (현재)                        |
| ------------------- | -------------------------------------------------------- | ------------------------------------- |
| `vector(1536)` 컬럼 | `Unsupported()` — 클라이언트로 읽기/쓰기 불가, raw 전용  | `vector({dimensions:1536})` 정식 타입 |
| HNSW 인덱스         | 스키마로 표현 불가 → `migrate dev` 가 매번 DROP 을 제안  | `index().using("hnsw", col.op(...))`  |
| 유사도 검색         | SQL 함수를 따로 만들고 마이그레이션 밖에서 적용해야 했음 | `cosineDistance()` 를 TS 로 조합      |
| 코드 생성           | `src/generated/prisma` + `postinstall` 필요              | 없음                                  |

## Tech Stack

| 영역         | 기술                                             | 버전        |
| ------------ | ------------------------------------------------ | ----------- |
| Framework    | Next.js (App Router, Server Actions)             | 16.3.0      |
| Runtime      | React / React DOM                                | 19.2.8      |
| Language     | TypeScript                                       | ^5          |
| Database     | PostgreSQL + pgvector (Docker)                   | 17 / 0.8    |
| ORM          | Drizzle ORM + drizzle-kit (node-postgres)        | 0.45 / 0.31 |
| AI           | OpenAI (`text-embedding-3-small`, `gpt-4o-mini`) | SDK ^7      |
| Scraping     | cheerio                                          | ^1.2        |
| Styling      | Tailwind CSS                                     | ^4          |
| UI           | shadcn/ui (base-nova) + Base UI                  | ^4.16       |
| Client State | Zustand                                          | ^5          |
| Server State | TanStack Query                                   | ^5          |
| Validation   | zod (LLM 응답 검증)                              | ^4          |
| Font         | Pretendard Variable (next/font/local)            | 1.3.9       |
| Package Mgr  | pnpm                                             | 9.15.4      |

## Project Structure

```
web/
├── docker-compose.yml           # Postgres + pgvector (호스트 포트 5434)
├── docker/postgres/initdb/      # 최초 기동 시 확장 설치 (vector, pg_trgm)
├── drizzle/                     # drizzle-kit 이 생성한 마이그레이션 (손으로 고치지 않는다)
├── drizzle.config.ts
├── scripts/ingest.ts            # 수집 CLI
├── src/
│   ├── db/
│   │   ├── schema.ts            # 테이블 · enum · 인덱스 · 관계 정의 (SoT)
│   │   ├── index.ts             # db 클라이언트 + schema 재수출
│   │   ├── load-env.ts          # CLI 스크립트용 env 로더
│   │   └── seed.ts              # 데모 사용자 + 사업 1건 + 공고 6건 + 지원서 1건
│   ├── app/
│   │   ├── page.tsx             # 대시보드 (4단계 진행 현황)
│   │   ├── business/            # STEP 1 사업 프로필
│   │   ├── ingestion/           # STEP 2 수집 현황
│   │   ├── announcements/       # STEP 2 공고 목록
│   │   ├── recommendations/     # STEP 3 큐레이션
│   │   ├── applications/[id]/   # STEP 4 AI 검토 · 초안 작성
│   ├── components/layout/       # AppSidebar, PageShell, nav-items
│   ├── features/
│   │   ├── business/            # 사업 프로필 저장 + 임베딩
│   │   ├── ingestion/           # 수집 · 첨부 파싱 · 임베딩 갱신 · 운영 UI
│   │   ├── announcement/        # 공고 조회 · 목록 UI
│   │   ├── recommendation/      # 벡터 검색 · LLM 평가 · 큐레이션 UI
│   │   └── application/         # 지원서 · AI 검토 · 초안 작성
│   ├── lib/                     # openai, embedding, env, current-user, text, format
│   ├── components/ui/           # shadcn/ui
│   └── hooks/ providers/ stores/ types/
└── tsconfig.json                # @/* → src/*
```

## 데이터 모델

정의는 [src/db/schema.ts](src/db/schema.ts) 한 파일이다.

| 테이블                           | 역할                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| `users`                          | 사용자 (데모 수준 — 인증은 미구현)                         |
| `user_businesses`                | 사업 아이템 프로필. `description` 이 추천 기준 벡터의 원문 |
| `announcements`                  | 수집된 공고. `(source, external_id)` 유니크로 중복 방지    |
| `announcement_attachments`       | 첨부파일 + 추출 텍스트 + `parse_status`                    |
| `applications`                   | 담아둔 공고 = AI 검토·작성의 작업 단위                     |
| `application_reviews`            | AI 요건 검토 1건 (다시 돌리면 덮어씀)                      |
| `application_eligibility_checks` | 자격요건 항목별 판정 (MET/UNMET/UNKNOWN)                   |
| `application_drafts`             | 사업계획서 섹션별 초안 (AI 생성 + 사용자 편집)             |
| `ingestion_runs`                 | 수집 실행 기록 — 실패·0건 수집을 화면에서 확인             |
| `llm_evaluations`                | LLM 정밀 평가 캐시 — 같은 조합 재호출을 막는다             |

- `embedding`(1536d)은 `user_businesses` / `announcements` 두 곳에 있다.
- `embedding_hash` 는 임베딩 원문의 SHA-256 — 값이 같으면 재임베딩을 건너뛴다(비용 절감).
  첨부 파싱으로 본문이 바뀌면 이 값을 `null` 로 만들어 재임베딩 대상으로 되돌린다.
- `announcements.is_sample` 은 `pnpm db:seed` 가 넣은 개발용 가짜 공고 표시다. 이 공고는 url 이
  사이트 루트뿐이라 화면에서 「샘플」 배지가 붙고 원문 링크가 막힌다
  ([announcement-title.tsx](src/components/common/announcement-title.tsx)). 실제 수집 공고와
  섞이므로 새 목록 UI 를 만들 때 이 필드를 같이 노출할 것. 지우려면
  `DELETE FROM announcements WHERE is_sample;`
- **컬럼명은 `casing: "snake_case"` 로 자동 변환된다.** 스키마에는 camelCase 프로퍼티만 쓰고
  DB 이름을 따로 적지 않는다. 이 옵션은 `drizzle.config.ts` 와 `src/db/index.ts` 양쪽에 있어야 한다.
- **스키마에 컬럼을 추가하면 dev 서버의 캐시된 db 클라이언트가 문제를 일으킬 수 있다.**
  `src/db/index.ts` 가 schema 모듈 identity 를 비교해 클라이언트를 다시 만들도록 해 뒀다.
  이 방어가 없으면 `Cannot read properties of undefined (reading 'replace')` 로 터진다.

## Dev Commands

| 명령어                 | 설명                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `pnpm db:up`           | Docker Postgres 기동 (healthy 될 때까지 대기)                     |
| `pnpm db:generate`     | 스키마 변경 → 마이그레이션 SQL 생성                               |
| `pnpm db:migrate`      | 생성된 마이그레이션 적용                                          |
| `pnpm db:push`         | 마이그레이션 없이 스키마 직접 반영 (실험용)                       |
| `pnpm db:check`        | 마이그레이션 충돌 검사                                            |
| `pnpm db:seed`         | 샘플 데이터 주입                                                  |
| `pnpm db:setup`        | up → migrate → seed 한 번에                                       |
| `pnpm db:down`         | 컨테이너 정지 (데이터 유지)                                       |
| `pnpm db:nuke`         | 볼륨까지 삭제 (데이터 소멸)                                       |
| `pnpm db:psql`         | 컨테이너 안 psql 접속                                             |
| `pnpm db:studio`       | Drizzle Studio                                                    |
| `pnpm db:embed`        | 미임베딩 공고만 임베딩                                            |
| `pnpm ingest`          | 공고 수집 (`--source=` / `--dry-run` / `--max-pages=` / `--full`) |
| `pnpm dev`             | 개발 서버 (Turbopack)                                             |
| `pnpm build`           | 프로덕션 빌드                                                     |
| `pnpm typecheck`       | `tsc --noEmit`                                                    |
| `pnpm lint` / `format` | ESLint / Prettier                                                 |

**최초 세팅**: `pnpm db:setup` → `pnpm dev`

**스키마 변경 절차**: `src/db/schema.ts` 수정 → `pnpm db:generate` → 생성된 SQL 확인 →
`pnpm db:migrate`. `drizzle/` 안의 파일은 손으로 고치지 않는다.

## Patterns & Conventions

### VAC (View–Action–Container)

기능은 `src/features/[feature-name]/` 아래에 자기완결형으로 모은다.

```
src/features/recommendation/
├── components/          # View  — props 만 받아 그리는 UI
├── api/                 # 데이터 접근 (벡터 검색, 키워드 검색, LLM 호출)
├── actions.ts           # Action — "use server" Server Action
├── types.ts             # 이 feature 전용 타입
└── index.ts             # 외부 공개 진입점 (배럴)
```

- feature 간 import 는 배럴(`index.ts` / `client.ts`)을 통해서만. 내부 경로를 가로질러 import 하지 않는다.
- `api/` 는 서버에서만 실행된다 — 클라이언트 컴포넌트에서 직접 import 하지 말 것.

**클라이언트 경계에서는 `client.ts` 배럴을 쓴다.** `index.ts` 는 `api/*`(DB 직접 접근)까지
re-export 하므로, 클라이언트 컴포넌트가 `@/features/application` 을 import 하면 `pg` 가
브라우저 번들로 끌려가 빌드가 깨진다. 실제로 한 번 깨졌고 그래서
[client.ts](src/features/application/client.ts) 를 분리했다.

```ts
// 서버 컴포넌트 / 서버 코드
import { listApplications } from "@/features/application";
// 클라이언트 컴포넌트
import { SaveApplicationButton } from "@/features/application/client";
```

### pgvector 다루기

```ts
// 쓰기 — 일반 컬럼처럼 number[] 를 그대로 넣는다
await db
  .update(announcements)
  .set({ embedding: vector, embeddingHash: contentHash(source) })
  .where(eq(announcements.id, id));

// 읽기 — distance 오름차순으로 정렬해야 HNSW 인덱스를 탄다
const distance = cosineDistance(announcements.embedding, queryEmbedding);
await db
  .select({ ...columns, similarity: sql<number>`1 - (${distance})` })
  .from(announcements)
  .where(and(isNotNull(announcements.embedding), lte(distance, 1 - threshold)))
  .orderBy(distance)
  .limit(limit);
```

- `1 - distance` 로 감싸 정렬하거나 필터하면 인덱스를 못 탄다. 임계값도 거리 기준
  (`distance <= 1 - threshold`)으로 바꿔서 건다.
- 임베딩 모델을 바꾸면 차원이 달라진다 → `src/db/schema.ts` 의 `EMBEDDING_DIMENSIONS` 를
  고치고 `pnpm db:generate` 로 마이그레이션을 만든다. 기존 임베딩은 전부 무효이므로
  `embedding_hash` 를 비워 재생성해야 한다.

### CLI 스크립트의 env 로딩

ESM 은 import 를 모듈 본문보다 먼저 평가한다. 스크립트 본문에서 dotenv 를 부르면 이미
`src/db/index.ts` 가 평가된 뒤라 `DATABASE_URL` 이 비어 있다. 그래서 스크립트는
**`import "@/db/load-env"` 를 첫 번째 import 로** 둔다. Next.js 는 `.env.local` 을 자동으로
읽으므로 앱 경로에는 필요 없다.

### Naming

| 대상              | 규칙              | 예시                               |
| ----------------- | ----------------- | ---------------------------------- |
| 파일 / 폴더       | kebab-case        | `vector-search.ts`, `k-startup.ts` |
| 컴포넌트          | PascalCase        | `RecommendationForm`               |
| 훅                | camelCase + `use` | `useSubsidyList`                   |
| Zustand 스토어    | `use*Store`       | `useExampleStore`                  |
| 타입 / 인터페이스 | PascalCase        | `RecommendResult`                  |
| DB 테이블/컬럼    | snake_case (자동) | `embedding_hash`                   |

### State Management

| 상태 종류            | 도구                           | 위치                           |
| -------------------- | ------------------------------ | ------------------------------ |
| 서버 데이터          | Server Action / TanStack Query | `features/*/api`, `actions.ts` |
| 전역 클라이언트 상태 | Zustand                        | `src/stores/`                  |
| 로컬 UI 상태         | `useState`                     | 컴포넌트 내부                  |

## Style Guide

- 모든 색상·반경 토큰은 [globals.css](src/app/globals.css) 의 `:root` / `.dark` 에 있다. 하드코딩된 색(`bg-zinc-900`)을 쓰지 않는다.
- 색상 체계는 oklch 유지(shadcn 기본값). `--radius` 하나로 sm~4xl 이 파생된다.
- 본문/제목은 Pretendard Variable (`--font-sans`, `--font-heading`), 로컬 로드라 외부 네트워크 의존이 없다.
- 날짜는 `formatDate()` (ISO yyyy-MM-dd) 를 쓴다 — 서버/클라이언트 타임존 차이로 인한 hydration 불일치를 피하기 위함.

## 환경 변수

`.env.local` 이 로컬 단일 소스다. Next.js 와 CLI 스크립트(`src/db/load-env.ts`), drizzle-kit 이
모두 이 파일을 읽는다. 키 목록은 `.env.example` 참고.

| 키                       | 필수 | 비고                                                          |
| ------------------------ | ---- | ------------------------------------------------------------- |
| `DATABASE_URL`           | ✓    | Docker Postgres. 호스트 포트 기본값 **5434**                  |
| `POSTGRES_PORT`          |      | docker-compose 포트 치환용 (기본 5434)                        |
| `OPENAI_API_KEY`         |      | 없으면 키워드 검색 폴백 + 임베딩 생략                         |
| `OPENAI_EMBEDDING_MODEL` |      | 기본 `text-embedding-3-small`                                 |
| `OPENAI_EVAL_MODEL`      |      | 기본 `gpt-4o-mini`                                            |
| `DATA_GO_KR_SERVICE_KEY` |      | 없으면 K-Startup 수집을 건너뛴다                              |
| `BIZINFO_BASE_URL`       |      | 기업마당 호스트. 키 불필요 (기본 `https://www.bizinfo.go.kr`) |
| ~~`CRON_SECRET`~~        |      | 미사용 — 자동 수집 엔드포인트를 제거해 더 이상 읽지 않는다    |

### 브라우저에서 넣는 휘발성 API 키

`OPENAI_API_KEY` 와 `DATA_GO_KR_SERVICE_KEY` 는 `.env` 에 두지 않고 화면에서 넣을 수 있다.
STEP 2 「수집 현황」의 **API 키** 패널이 입력을 받고, sessionStorage 에만 보관한다(탭 닫으면 소멸).

읽는 우선순위는 **요청에 실린 키 > `.env`** 다. 화면에 안 넣어도 CLI(`pnpm ingest`)는 `.env` 로 동작한다.

```
브라우저 (sessionStorage)           서버
  api-keys-store.ts  ──keys──▶  서버 액션
                                   └ withRuntimeKeys(keys, ...)   ← AsyncLocalStorage
                                        └ env.openaiApiKey()      ← runtimeKey ?? process.env
```

- 키를 인자로 넘기지 않고 [runtime-keys.ts](src/lib/runtime-keys.ts) 의 요청 스코프 컨텍스트를
  쓴다. 어댑터·임베딩·LLM 세 갈래로 흩어진 사용처의 시그니처를 오염시키지 않기 위해서다.
- **새 서버 액션이 API 키를 쓴다면** 마지막 인자로 `keys?: RuntimeKeys` 를 받고 본문을
  `withRuntimeKeys(keys, ...)` 로 감싼다. 안 감싸면 조용히 `.env` 값만 쓰게 된다.
- 서버는 이 키를 DB·파일·로그에 쓰지 않는다. 화면에는 `.env` 키의 **존재 여부만** 내려보내고
  값은 절대 내려보내지 않는다.
- 어댑터는 `requiresKey` 로 필요한 키를 선언한다 — 화면에서 키를 넣는 즉시 소스 카드의
  「설정 필요」 배지가 사라지게 하는 데 쓴다.
- ⚠️ sessionStorage 는 같은 페이지 스크립트가 읽을 수 있다(XSS 시 노출). 공용 PC 에서는 쓰지 말 것.

**data.go.kr 인증키 주의** — 포털이 주는 "일반 인증키"는 URL 인코딩된 문자열(`%2B` 포함)이다.
이걸 `URLSearchParams` 에 그대로 넣으면 `%` 가 다시 인코딩돼(`%252B`)
`SERVICE_KEY_IS_NOT_REGISTERED_ERROR`(코드 30) 로 403 이 난다. 인코딩/디코딩 어느 쪽 키를
넣어도 되도록 [k-startup.ts](src/features/ingestion/sources/k-startup.ts) 의
`normalizeServiceKey()` 가 `decodeURIComponent` 를 한 번 태운다. 다른 data.go.kr API 를
붙일 때도 같은 처리가 필요하다.

## Notes

### 미구현 / 다음 작업

- **첨부파일 파서** — `attachment-parser.ts` 에 plain-text 파서만 등록돼 있다. HWPX(zip+XML) → PDF → HWP 순으로 붙이는 것을 권장. `registerParser()` 로 등록만 하면 파이프라인이 자동으로 사용한다.
- **egbiz 셀렉터** — `sources/egbiz.ts` 의 `SELECTORS` 와 목록 URL 은 아직 자리표시자다. 상세 URL 형식은 `egbiz.or.kr/sp/supportPrjDtl.do?bizCyclId=PD...` 로 확인했고 서버 렌더도 되지만, egbiz 공고 상당수가 기업마당에도 올라오므로 우선순위를 낮춰 두었다. 수집 전 robots.txt / 이용약관 확인.
- **기업마당 마크업 의존** — `sources/bizinfo.ts` 는 스크레이퍼라 마크업이 바뀌면 조용히 0건이 된다. 라벨(`span.s_title`) → 값(`div.txt`) 매핑이라 항목 순서 변경에는 강하지만, 지원분야는 제목 위 `div.category` 배지에서 읽으므로 이쪽이 바뀌면 `category` 가 비게 된다. 수집 0건이면 `ingestion_runs` 로 감지할 것. 공식 오픈 API(기업마당 발급 `crtfcKey`, data.go.kr 키와 다름)로 갈아탈 여지도 있다.
- **기업마당 페이지 크기는 15건 고정** — `rows` · `pageUnit` · `recordCountPerPage` · `pageSize` 어느 것을 넘겨도 15건만 온다(실측). `cpage` 만 동작하므로 `FetchOptions.pageSize` 는 이 소스에서 무시된다. 수집량은 `maxPages`(기본 20 = 300건)로만 조절한다.
- **인증** — `users` 테이블만 있고 로그인은 없다. 모든 화면이 데모 계정 하나를 공유한다.
- **사업 프로필 다중 등록** — 스키마는 여러 건을 지원하지만 UI 는 가장 최근 1건만 다룬다.
- **추천 결과 캐시** — 매 조회마다 다시 계산한다. 반복 조회가 잦아지면 테이블에 캐싱할 것.
- **초안 내보내기** — 섹션 초안을 한글(HWP)/워드로 내보내는 기능이 없다. 현재는 복사해서 쓴다.
- **알림** — Resend / 카카오 알림톡 미구현.
- **마크다운 렌더링** — 초안은 마크다운으로 생성되지만 편집기는 plain textarea 다.

### shadcn 컴포넌트 추가

```bash
pnpm dlx shadcn@latest add dialog
```

**shadcn v4 는 `asChild` 를 쓰지 않는다.** 다른 엘리먼트로 렌더하려면 `render` prop:

```tsx
<Button render={<Link href="/" />}>홈으로</Button>
```

### Next.js 16 주의

- `error.tsx` 의 복구 prop 은 `reset` 이 아니라 **`retry`** (16.3 stable).
- Turbopack 이 기본 번들러.
- `LayoutProps<"/">` / `PageProps<"/applications/[id]">` 같은 라우트 타입은 자동 생성 — 직접 선언하지 않는다. 라우트를 추가한 뒤 타입이 안 잡히면 `pnpm next typegen`.
- API 가 학습 데이터와 다를 수 있으니 `node_modules/next/dist/docs/` 를 먼저 확인한다 (AGENTS.md 참고).

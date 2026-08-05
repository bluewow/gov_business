import { runtimeKey } from "@/lib/runtime-keys";

/**
 * 서버 전용 환경 변수 접근자.
 *
 * import 시점이 아니라 "사용 시점"에 검증한다.
 * 빌드/렌더 단계에서 키가 없다는 이유로 앱 전체가 죽는 것을 막기 위함.
 *
 * API 키는 "브라우저에서 넘어온 휘발성 키 > .env" 순으로 읽는다.
 * 화면에서 키를 넣으면 그 요청에만 쓰이고, 안 넣으면 .env 로 폴백한다.
 */

function read(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function required(key: string, hint: string): string {
  const value = read(key);
  if (!value) {
    throw new Error(`환경 변수 ${key} 가 설정되지 않았습니다. ${hint}`);
  }
  return value;
}

export const env = {
  databaseUrl: () =>
    required(
      "DATABASE_URL",
      ".env.local 에 추가한 뒤 `pnpm db:up` 으로 DB 를 기동하세요.",
    ),

  /** 없으면 AI 기능(임베딩/LLM 평가)을 건너뛴다. 화면 입력 키가 있으면 그쪽이 우선. */
  openaiApiKey: () => runtimeKey("openai") ?? read("OPENAI_API_KEY"),
  requireOpenaiApiKey: () => {
    const key = runtimeKey("openai") ?? read("OPENAI_API_KEY");
    if (!key) {
      throw new Error(
        "OpenAI API 키가 없습니다. 사이드바 「설정 → API 키」 에서 입력하거나 .env.local 에 OPENAI_API_KEY 를 추가하세요.",
      );
    }
    return key;
  },
  embeddingModel: () =>
    read("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
  evaluationModel: () => read("OPENAI_EVAL_MODEL") ?? "gpt-4o-mini",

  /** 공공데이터포털 서비스키. 화면 입력 키가 있으면 그쪽이 우선. */
  dataGoKrServiceKey: () =>
    runtimeKey("dataGoKr") ?? read("DATA_GO_KR_SERVICE_KEY"),
  kStartupBaseUrl: () =>
    read("K_STARTUP_API_BASE_URL") ??
    "https://apis.data.go.kr/B552735/kisedKstartupService01",
  kStartupPath: () =>
    read("K_STARTUP_API_PATH") ?? "/getAnnouncementInformation01",

  /** 기업마당은 공개 페이지 스크레이핑이라 키가 없다 — 호스트만 바꿀 수 있게 열어 둔다 */
  bizinfoBaseUrl: () => read("BIZINFO_BASE_URL") ?? "https://www.bizinfo.go.kr",

  egbizBaseUrl: () => read("EGBIZ_BASE_URL") ?? "https://www.egbiz.or.kr",
} as const;

/** OpenAI 키가 있어야만 돌아가는 경로에서 사전 분기용 */
export function isAiEnabled(): boolean {
  return Boolean(env.openaiApiKey());
}

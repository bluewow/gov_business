/** 키워드 매칭 방식 — any: 하나라도 포함(넓게) / all: 모두 포함(좁게) */
export type KeywordMode = "any" | "all";

export interface MatchFilter {
  /**
   * 1차 필터 — 키워드. 제목·요약·본문·분야·지역·지원대상·기관에서 부분일치로 찾으므로
   * 「경기」·「창업」 처럼 넣으면 예전 지역/분야 필터와 같은 역할을 한다.
   */
  keywords?: string[];
  /** 키워드 결합 방식 (기본 any) */
  keywordMode?: KeywordMode;
  /** 모집 마감된 공고 제외 */
  onlyOpen?: boolean;
  /** 코사인 유사도 하한 (0~1) */
  threshold?: number;
  /**
   * 이 사업이 이미 지원서로 담아둔 공고를 결과에서 뺀다.
   * 추천은 "새 공고 발굴" 화면이라 이미 결정한 건이 자리(와 LLM 평가 슬롯)를
   * 차지하면 낭비다. 담아둔 것은 STEP 4 에서 본다.
   */
  excludeSavedForBusinessId?: string | null;
  /** 반환 개수 */
  limit?: number;
}

/** match_announcements() 가 돌려주는 행 */
export interface MatchedAnnouncement {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  content: string;
  url: string;
  category: string | null;
  region: string | null;
  targetAudience: string | null;
  agency: string | null;
  startDate: Date | null;
  endDate: Date | null;
  /** seed 로 넣은 개발용 가짜 공고 */
  isSample: boolean;
  /** LLM 평가 캐시 무효화 판단용 (임베딩 전이면 null) */
  embeddingHash: string | null;
  /** 코사인 유사도 0~1 */
  similarity: number;
  /** 요청한 키워드 중 실제로 이 공고에서 걸린 것 */
  matchedKeywords: string[];
  /**
   * 이 공고가 후보에 든 이유.
   * keyword: 키워드가 걸려서 / semantic: 키워드는 안 걸렸지만 프로필과 의미가 가까워서.
   * 키워드를 안 넣었으면 전부 semantic 이다.
   */
  matchedBy: "keyword" | "semantic";
  /** 같은 공고가 잡힌 다른 소스 (중복을 접고 남긴 흔적) */
  duplicateSources: string[];
}

/** 3차 LLM 정밀 평가 결과 */
export interface LlmEvaluation {
  /** 적합도 0~100 */
  score: number;
  /** 추천 이유 2줄 요약 */
  reason: string;
}

export interface RecommendationItem extends MatchedAnnouncement {
  llmScore: number | null;
  llmReason: string | null;
}

export interface RecommendInput {
  /** 탐색 키워드. 비우면 사업 프로필과 가까운 순서로 전체를 훑는다 */
  keywords?: string[];
  keywordMode?: KeywordMode;
  /** 모집 마감된 공고 제외 (기본 true) */
  onlyOpen?: boolean;
  /** 3차 LLM 정밀 평가 실행 여부 */
  useLlm?: boolean;
  limit?: number;
}

export interface RecommendResult {
  /** vector: 임베딩 기반 / keyword: OPENAI_API_KEY 가 없을 때의 폴백 */
  mode: "vector" | "keyword";
  /** 실제로 적용된 키워드 (정규화 후) — 화면에 무엇으로 찾았는지 되돌려 보여준다 */
  keywords: string[];
  keywordMode: KeywordMode;
  items: RecommendationItem[];
  /** 사용자에게 보여줄 안내(폴백 사유·다음 액션 등) */
  notice?: string;
  error?: string;
}

import type { AnnouncementSource } from "@/db/schema";
import type { RuntimeKeys } from "@/lib/runtime-keys";

/** 수집기가 원본 시스템에서 뽑아낸 정규화 전 공고 */
export interface RawAnnouncement {
  source: AnnouncementSource;
  /** 원본 시스템의 공고 식별자. source 와 조합해 유일해야 한다. */
  externalId: string;
  title: string;
  content: string;
  url: string;
  /** 공고가 가리키는 원문 링크 (egbiz 의 「관련사이트」 등) */
  sourceUrl?: string | null;
  summary?: string | null;
  category?: string | null;
  region?: string | null;
  targetAudience?: string | null;
  agency?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  attachments?: RawAttachment[];
}

export interface RawAttachment {
  fileName: string;
  fileUrl: string;
  mimeType?: string | null;
}

export interface FetchOptions {
  /** 한 페이지당 건수. 원본이 페이지 크기를 고정한 소스에서는 무시된다 */
  pageSize?: number;
  /** 최대 페이지 수 — 초기 적재 시에만 크게 잡는다 */
  maxPages?: number;
  /**
   * 이미 DB 에 있는 공고의 externalId 집합.
   *
   * **필터가 아니라 "멈춤 신호"다.** 목록이 최신순인 소스에서, 한 페이지가 전부 아는
   * 공고면 그 뒤로도 전부 아는 공고이므로 더 거슬러 올라가지 않는다. 첫 수집(빈 집합)은
   * 끝까지 훑고, 이후 정기 수집은 새 공고가 끊기는 지점에서 멈춘다.
   *
   * 아는 공고도 결과에는 그대로 담는다 — 마감일 변경 같은 갱신을 놓치지 않기 위함이다.
   */
  knownExternalIds?: ReadonlySet<string>;
}

/**
 * 공고 출처 하나를 담당하는 어댑터.
 * 새 출처(비즈인포 등)를 추가할 때 이 인터페이스만 구현하면 ingest 파이프라인에 그대로 붙는다.
 */
export interface AnnouncementSourceAdapter {
  source: AnnouncementSource;
  label: string;
  /** 설정(API 키 등)이 갖춰졌는지 */
  isConfigured(): boolean;
  /**
   * 이 소스가 필요로 하는 휘발성 API 키. 화면에서 키를 넣었을 때
   * 「설정 필요」 배지를 실시간으로 지우는 데 쓴다. 키가 필요 없으면 생략.
   */
  requiresKey?: keyof RuntimeKeys;
  fetchAnnouncements(options?: FetchOptions): Promise<RawAnnouncement[]>;
}

export interface IngestionResult {
  source: AnnouncementSource;
  fetched: number;
  created: number;
  updated: number;
  embedded: number;
  skippedReason?: string;
  error?: string;
}

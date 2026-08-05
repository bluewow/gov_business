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
  /** 한 페이지당 건수 */
  pageSize?: number;
  /** 최대 페이지 수 — 초기 적재 시에만 크게 잡는다 */
  maxPages?: number;
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

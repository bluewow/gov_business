import { env } from "@/lib/env";
import { normalizeWhitespace, parseKoreanDate, stripHtml } from "@/lib/text";

import type {
  AnnouncementSourceAdapter,
  FetchOptions,
  RawAnnouncement,
} from "../types";

/**
 * K-Startup 창업지원포털 공고 — 공공데이터포털(data.go.kr) 오픈 API.
 *   서비스   : 창업진흥원_K-Startup(사업소개, 사업공고, 콘텐츠 등)_조회서비스
 *   엔드포인트: https://apis.data.go.kr/B552735/kisedKstartupService01
 *   오퍼레이션: /getAnnouncementInformation01 (공고 조회, 약 3만 건)
 *
 * 아래 필드명은 실제 응답을 받아 확인한 값이다(추측 아님).
 * 사업 소개 정보가 더 필요하면 /getBusinessInformation01 을 별도 어댑터로 붙이면 된다.
 */

interface Row {
  /** 공고 일련번호 — 원본 시스템의 고유 ID */
  pbanc_sn?: number | string;
  /** 공고명 (실제 공고 제목) */
  biz_pbanc_nm?: string;
  /** 통합공고 사업명 — 상위 프로그램 이름이라 제목으로 쓰면 안 된다 */
  intg_pbanc_biz_nm?: string;
  /** 공고 본문 */
  pbanc_ctnt?: string;
  /** 상세 페이지 URL */
  detl_pg_url?: string;
  /** 지원사업 분류 (예: 글로벌, 사업화) */
  supt_biz_clsfc?: string;
  /** 지원 지역 (예: 전국, 경기) */
  supt_regin?: string;
  /** 신청 대상 설명 */
  aply_trgt_ctnt?: string;
  /** 신청 대상 구분 (예: 대학생,일반기업) */
  aply_trgt?: string;
  /** 대상 업력 (예: 예비창업자,3년미만) */
  biz_enyy?: string;
  /** 대상 연령 */
  biz_trgt_age?: string;
  /** 공고 기관명 */
  pbanc_ntrp_nm?: string;
  /** 감독 기관 구분 */
  sprv_inst?: string;
  /** 접수 시작일 (YYYYMMDD) */
  pbanc_rcpt_bgng_dt?: string;
  /** 접수 종료일 (YYYYMMDD) */
  pbanc_rcpt_end_dt?: string;
  /** 모집 진행 여부 Y/N */
  rcrt_prgs_yn?: string;
  [key: string]: unknown;
}

interface ApiResponse {
  currentCount?: number;
  matchCount?: number;
  totalCount?: number;
  data?: Row[];
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed && trimmed !== "null" ? trimmed : null;
}

/**
 * data.go.kr 의 "일반 인증키"는 URL 인코딩된 형태(`%2B` 포함)로 발급된다.
 * 그대로 URLSearchParams 에 넣으면 `%` 가 다시 인코딩돼(`%252B`)
 * SERVICE_KEY_IS_NOT_REGISTERED_ERROR(코드 30) 가 난다.
 * 디코딩해 두면 인코딩/디코딩 어느 쪽 키를 넣어도 동작한다.
 */
function normalizeServiceKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    // 이미 디코딩된 키에 단독 `%` 가 있는 경우 — 그대로 쓴다
    return key;
  }
}

async function fetchPage(page: number, perPage: number): Promise<Row[]> {
  const serviceKey = env.dataGoKrServiceKey();
  if (!serviceKey) return [];

  const url = new URL(`${env.kStartupBaseUrl()}${env.kStartupPath()}`);
  url.searchParams.set("serviceKey", normalizeServiceKey(serviceKey));
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", String(perPage));
  url.searchParams.set("returnType", "json");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    // 공고는 하루 단위로 갱신되므로 캐시가 의미 없다
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `K-Startup API 호출 실패 (HTTP ${response.status}): ${(
        await response.text()
      ).slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as ApiResponse;
  return payload.data ?? [];
}

/** 지원대상이 여러 필드에 흩어져 있다 — AI 요건 검토가 쓰도록 한 줄로 합친다 */
function buildTargetAudience(row: Row): string | null {
  const targetType = text(row.aply_trgt);
  const businessAge = text(row.biz_enyy);
  const age = text(row.biz_trgt_age);

  const parts = [
    text(row.aply_trgt_ctnt),
    targetType && `대상 구분: ${targetType}`,
    businessAge && `업력: ${businessAge}`,
    age && `연령: ${age}`,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : null;
}

function toRawAnnouncement(row: Row): RawAnnouncement | null {
  const externalId = text(row.pbanc_sn);
  const title = text(row.biz_pbanc_nm) ?? text(row.intg_pbanc_biz_nm);
  if (!externalId || !title) return null;

  const body = normalizeWhitespace(stripHtml(text(row.pbanc_ctnt) ?? ""));
  const program = text(row.intg_pbanc_biz_nm);
  const region = text(row.supt_regin);

  const content =
    [program && program !== title ? `[${program}]` : null, body]
      .filter(Boolean)
      .join(" ") || title;

  return {
    source: "K_STARTUP",
    externalId,
    title,
    content,
    url:
      text(row.detl_pg_url) ??
      `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${externalId}`,
    category: text(row.supt_biz_clsfc),
    // "전국" 은 지역 무관이라는 뜻이므로 null 로 둔다 (지역 필터가 항상 통과시킨다)
    region: region === "전국" ? null : region,
    targetAudience: buildTargetAudience(row),
    agency: text(row.pbanc_ntrp_nm) ?? text(row.sprv_inst),
    startDate: parseKoreanDate(text(row.pbanc_rcpt_bgng_dt)),
    endDate: parseKoreanDate(text(row.pbanc_rcpt_end_dt)),
    attachments: [],
  };
}

export const kStartupAdapter: AnnouncementSourceAdapter = {
  source: "K_STARTUP",
  label: "K-Startup 창업지원포털",

  isConfigured: () => Boolean(env.dataGoKrServiceKey()),
  requiresKey: "dataGoKr",

  async fetchAnnouncements(options: FetchOptions = {}) {
    const perPage = options.pageSize ?? 100;
    const maxPages = options.maxPages ?? 3;
    const collected: RawAnnouncement[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const rows = await fetchPage(page, perPage);
      if (rows.length === 0) break;

      for (const row of rows) {
        const announcement = toRawAnnouncement(row);
        if (announcement) collected.push(announcement);
      }

      // 마지막 페이지
      if (rows.length < perPage) break;
    }

    return collected;
  },
};

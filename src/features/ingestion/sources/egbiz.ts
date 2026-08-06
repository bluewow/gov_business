import * as cheerio from "cheerio";

import { env } from "@/lib/env";
import { normalizeWhitespace, parseKoreanDate, stripHtml } from "@/lib/text";

import type {
  AnnouncementSourceAdapter,
  FetchOptions,
  RawAnnouncement,
  RawAttachment,
} from "../types";

/**
 * 경기기업비서(egbiz) — 경기도 지원사업 공고.
 *
 * 목록 페이지(supportPrjCatList.do)는 자바스크립트로 채워져서 HTML 만 받아서는 항목이 비어 있다.
 * 대신 그 페이지가 쓰는 JSON 엔드포인트를 직접 호출한다 — 인증 없이 GET 으로 동작하고
 * pageIndex/pageUnit 로 페이징된다.
 *
 * 상세 페이지는 서버 렌더라 cheerio 로 읽을 수 있고, 아래 라벨 → 값 구조다.
 *   <li>
 *     <div class="conSec__con__title">신청자격</div>
 *     <div class="conSec__con__desc">...</div>
 *   </li>
 * 항목 순서가 바뀌어도 안 깨지도록 라벨 기준으로 뽑는다.
 *
 * 참고: egbiz 공고 상당수는 본문 없이 기업마당(bizinfo) 링크만 걸어 둔다.
 * 그래서 본문이 비면 목록 필드로 문맥을 채워 임베딩이 무의미해지지 않게 한다.
 */

const LIST_PATH = "/sp/selectSupportPrjListAjax.do";
const DETAIL_PATH = "/sp/supportPrjDtl.do";

/** 상세 요청 간격 — 공용 사이트이므로 과하게 두드리지 않는다 */
const REQUEST_DELAY_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 목록 JSON 한 행 (실제 응답을 보고 확인한 필드만 선언) */
interface ListRow {
  /** 공고 식별자 — 상세 URL 파라미터이자 externalId */
  bizCyclId?: string;
  /** 공고명 */
  bizNm?: string;
  /** 접수 시작/종료일 (YYYY-MM-DD) */
  aplyBgngDt?: string;
  aplyEndDt?: string;
  /** 수행기관 */
  outsdInstNm?: string;
  /** 분류 (예: 창업) */
  categoryNm?: string;
  /** 지원분야 구분 */
  sareaSeCd?: string;
}

interface ListResponse {
  result?: boolean;
  value?: ListRow[];
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) gov-biz-curator/0.1";

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed && trimmed !== "null" ? trimmed : null;
}

function detailUrl(bizCyclId: string): string {
  return `${env.egbizBaseUrl()}${DETAIL_PATH}?listUrl=supportPrjCatList&bizCyclId=${bizCyclId}`;
}

async function fetchListPage(
  page: number,
  pageUnit: number,
): Promise<ListRow[]> {
  const url = `${env.egbizBaseUrl()}${LIST_PATH}?pageIndex=${page}&pageUnit=${pageUnit}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`egbiz 목록 요청 실패 (HTTP ${response.status}): ${url}`);
  }

  const payload = (await response.json()) as ListResponse;
  return payload.value ?? [];
}

/**
 * 기업마당에서 그대로 가져온 공고인지.
 *
 * egbiz 는 사실상 기업마당의 경기도 필터 뷰에 가까워서, 수집한 50건 중 48건이
 * 기업마당 원문 링크를 갖고 있었다. 그대로 담으면 같은 공고가 두 소스에 중복 저장되고
 * (실제로 62개 그룹이 겹쳤다) 추천 목록에도 두 번 나온다.
 *
 * 기업마당 어댑터가 원문을 더 풍부하게 가져오므로, 미러 건은 여기서 담지 않는다.
 * 판별 근거는 수행기관 표기다 — "기업마당(고양산업진흥원)" 처럼 접두어가 붙는다.
 */
function isBizinfoMirror(row: ListRow): boolean {
  return (text(row.outsdInstNm) ?? "").startsWith("기업마당");
}

/** `[인천] 2026년 …` 처럼 제목 앞에 붙는 지역 표기를 뽑아낸다 */
function extractRegion(title: string): string | null {
  const matched = title.match(/^\s*\[([^\]]{2,10})\]/);
  const candidate = matched?.[1]?.trim();
  if (!candidate) return null;
  // [모집공고] 같은 비지역 태그는 걸러낸다
  return /공고|모집|재공고|연장|변경/.test(candidate) ? null : candidate;
}

/** 상세 페이지의 라벨 → 값 맵과 첨부파일 */
async function fetchDetail(bizCyclId: string): Promise<{
  pick: (...labels: string[]) => string | null;
  overviewHtml: string;
  bodyHtml: string;
  sourceUrl: string | null;
  attachments: RawAttachment[];
}> {
  const url = detailUrl(bizCyclId);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`egbiz 상세 요청 실패 (HTTP ${response.status}): ${url}`);
  }

  const $ = cheerio.load(await response.text());
  const fields = new Map<string, { text: string; html: string }>();

  $("li").each((_, element) => {
    const label = normalizeWhitespace(
      $(element).find("> .conSec__con__title").first().text(),
    );
    if (!label) return;
    const $value = $(element).find("> .conSec__con__desc").first();
    if ($value.length === 0) return;
    fields.set(label, {
      text: normalizeWhitespace($value.text()),
      html: $value.html() ?? "",
    });
  });

  const attachments: RawAttachment[] = [];
  $('a[href*="fileDown"]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    attachments.push({
      fileName: normalizeWhitespace($(element).text()) || "attachment",
      fileUrl: new URL(href, env.egbizBaseUrl()).toString(),
    });
  });

  // 본문은 라벨 목록이 아니라 별도 블록에 있다
  const bodyHtml = $(".conSec__con__contnets").first().html() ?? "";

  // 「관련사이트」 는 기업마당 원문을 가리키는 경우가 많다 — 첨부 추출 시 여기를 따라간다
  const sourceUrl =
    $(".conSec__con__desc a[href]")
      .toArray()
      .map((element) => $(element).attr("href") ?? "")
      .find((href) => /bizinfo\.go\.kr/i.test(href)) ?? null;

  return {
    bodyHtml,
    sourceUrl,
    pick: (...labels: string[]) => {
      for (const label of labels) {
        const found = fields.get(label);
        if (found?.text) return found.text;
      }
      return null;
    },
    overviewHtml:
      fields.get("사업개요")?.html ?? fields.get("지원내용")?.html ?? "",
    attachments,
  };
}

export const egbizAdapter: AnnouncementSourceAdapter = {
  source: "EGBIZ",
  label: "경기기업비서(egbiz)",

  // 공개 JSON 엔드포인트라 키가 필요 없다
  isConfigured: () => Boolean(env.egbizBaseUrl()),

  async fetchAnnouncements(options: FetchOptions = {}) {
    const pageUnit = options.pageSize ?? 50;
    const maxPages = options.maxPages ?? 2;
    const collected: RawAnnouncement[] = [];
    const seen = new Set<string>();
    let skippedMirrors = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const rows = await fetchListPage(page, pageUnit);
      if (rows.length === 0) break;

      for (const row of rows) {
        const externalId = text(row.bizCyclId);
        const title = text(row.bizNm);
        if (!externalId || !title || seen.has(externalId)) continue;
        seen.add(externalId);

        // 기업마당 미러는 건너뛴다 (그쪽 어댑터가 원문을 더 잘 가져온다)
        if (isBizinfoMirror(row)) {
          skippedMirrors += 1;
          continue;
        }

        let body: string | null = null;
        let targetAudience: string | null = null;
        let attachments: RawAttachment[] = [];
        let sourceUrl: string | null = null;

        await sleep(REQUEST_DELAY_MS);
        try {
          const detail = await fetchDetail(externalId);
          body =
            normalizeWhitespace(stripHtml(detail.bodyHtml)) ||
            normalizeWhitespace(stripHtml(detail.overviewHtml)) ||
            detail.pick("사업개요", "지원내용");
          targetAudience = detail.pick("신청자격", "지원대상", "신청대상");
          attachments = detail.attachments;
          sourceUrl = detail.sourceUrl;
        } catch (error) {
          // 상세 실패는 치명적이지 않다 — 목록 값만으로도 공고는 남긴다
          console.warn(`[egbiz] 상세 수집 실패: ${externalId}`, error);
        }

        // 본문이 비는 공고가 많아 목록 필드로라도 문맥을 채운다
        const content =
          body ||
          normalizeWhitespace(
            [
              title,
              text(row.categoryNm) && `분야: ${text(row.categoryNm)}`,
              text(row.sareaSeCd) && `지원분야: ${text(row.sareaSeCd)}`,
              text(row.outsdInstNm) && `수행기관: ${text(row.outsdInstNm)}`,
            ]
              .filter(Boolean)
              .join("\n"),
          );

        collected.push({
          source: "EGBIZ",
          externalId,
          title,
          content,
          url: detailUrl(externalId),
          sourceUrl,
          category: text(row.categoryNm) ?? text(row.sareaSeCd),
          region: extractRegion(title),
          targetAudience,
          agency: text(row.outsdInstNm),
          startDate: parseKoreanDate(text(row.aplyBgngDt)),
          endDate: parseKoreanDate(text(row.aplyEndDt)),
          attachments,
        });
      }

      // 마지막 페이지
      if (rows.length < pageUnit) break;
    }

    if (skippedMirrors > 0) {
      console.info(
        `[egbiz] 기업마당 미러 ${skippedMirrors}건을 건너뛰었습니다 (중복 방지).`,
      );
    }

    if (collected.length === 0 && skippedMirrors === 0) {
      console.warn(
        "[egbiz] 수집 0건입니다. 목록 JSON 응답 형식이 바뀌었을 수 있습니다.",
      );
    }

    return collected;
  },
};

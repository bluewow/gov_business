import * as cheerio from "cheerio";

import { env } from "@/lib/env";
import { normalizeWhitespace, stripHtml } from "@/lib/text";

import type {
  AnnouncementSourceAdapter,
  FetchOptions,
  RawAnnouncement,
} from "../types";

/**
 * 이지비즈(egbiz) — 공식 오픈 API 가 없어 목록/상세 페이지를 스크레이핑한다.
 *
 * ⚠️ 셀렉터 검증 필요
 * 아래 SELECTORS 는 실제 마크업을 보고 채워야 하는 자리표시자다.
 * 확인 방법: `pnpm ingest --source=EGBIZ --dry-run` 을 돌리면 수집 0건과 함께
 * 요청한 URL 이 찍히므로, 그 페이지의 DOM 을 보고 셀렉터만 교체하면 된다.
 *
 * 운영 시 주의:
 *  - robots.txt / 이용약관을 먼저 확인하고, 요청 간 간격(REQUEST_DELAY_MS)을 지킬 것
 *  - 목록 → 상세 순회는 요청 수가 많으므로 cron 주기를 넉넉히(1일 1~2회) 잡을 것
 *  - 마크업 변경에 취약하므로 수집 0건이면 알림이 가도록 IngestionRun 을 모니터링할 것
 */

const SELECTORS = {
  listItem: "table.board-list tbody tr",
  listLink: "td.title a",
  listDate: "td.date",
  detailTitle: "h2.view-title, .board-view .title",
  detailContent: ".board-view .content, .view-content",
  detailAttachment: ".attach-list a, a.file-down",
} as const;

const REQUEST_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      // 기본 fetch UA 는 차단되는 경우가 많다
      "User-Agent":
        "Mozilla/5.0 (compatible; gov-biz-bot/0.1; +https://example.com/bot)",
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`egbiz 페이지 요청 실패 (HTTP ${response.status}): ${url}`);
  }
  return response.text();
}

function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** 상세 URL 에서 안정적인 식별자를 뽑는다 (쿼리 파라미터 우선, 없으면 경로 마지막 조각) */
function externalIdFromUrl(url: string): string {
  const parsed = new URL(url);
  for (const key of ["seq", "idx", "id", "bbsSeq", "nttId"]) {
    const value = parsed.searchParams.get(key);
    if (value) return value;
  }
  return parsed.pathname.split("/").filter(Boolean).pop() ?? url;
}

async function fetchDetail(url: string): Promise<RawAnnouncement | null> {
  const $ = cheerio.load(await fetchHtml(url));

  const title = normalizeWhitespace($(SELECTORS.detailTitle).first().text());
  if (!title) return null;

  const contentHtml = $(SELECTORS.detailContent).first().html() ?? "";
  const content = normalizeWhitespace(stripHtml(contentHtml));

  const attachments = $(SELECTORS.detailAttachment)
    .toArray()
    .map((element) => {
      const $element = $(element);
      const href = $element.attr("href");
      if (!href) return null;
      return {
        fileName: normalizeWhitespace($element.text()) || "attachment",
        fileUrl: absoluteUrl(href, url),
      };
    })
    .filter((item): item is { fileName: string; fileUrl: string } =>
      Boolean(item),
    );

  return {
    source: "EGBIZ",
    externalId: externalIdFromUrl(url),
    title,
    // 본문이 비면 첨부파일 파서가 채워 넣는다
    content: content || title,
    url,
    attachments,
  };
}

export const egbizAdapter: AnnouncementSourceAdapter = {
  source: "EGBIZ",
  label: "이지비즈(egbiz)",

  // 스크레이퍼는 API 키가 필요 없다. base URL 만 있으면 동작 시도는 가능.
  isConfigured: () => Boolean(env.egbizBaseUrl()),

  async fetchAnnouncements(options: FetchOptions = {}) {
    const maxPages = options.maxPages ?? 2;
    const base = env.egbizBaseUrl();
    const collected: RawAnnouncement[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const listUrl = `${base}/board/announcement/list?page=${page}`;
      const $ = cheerio.load(await fetchHtml(listUrl));

      const detailUrls = $(SELECTORS.listItem)
        .toArray()
        .map((row) => $(row).find(SELECTORS.listLink).attr("href"))
        .filter((href): href is string => Boolean(href))
        .map((href) => absoluteUrl(href, listUrl));

      if (detailUrls.length === 0) {
        console.warn(
          `[egbiz] 목록에서 항목을 찾지 못했습니다. 셀렉터를 확인하세요: ${listUrl}`,
        );
        break;
      }

      for (const detailUrl of detailUrls) {
        await sleep(REQUEST_DELAY_MS);
        try {
          const announcement = await fetchDetail(detailUrl);
          if (announcement) collected.push(announcement);
        } catch (error) {
          console.warn(`[egbiz] 상세 수집 실패: ${detailUrl}`, error);
        }
      }
    }

    // 접수기간은 상세 페이지 파싱 또는 첨부파일 추출 단계에서 채운다.
    // 목록의 SELECTORS.listDate 를 쓰려면 detailUrls 수집 시 함께 매핑할 것.
    return collected;
  },
};

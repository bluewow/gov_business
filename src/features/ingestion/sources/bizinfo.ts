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
 * 기업마당(bizinfo.go.kr) — 중소벤처기업부 지원사업 통합 공고.
 *
 * 지자체·부처 공고가 여기로 모이기 때문에(경기기업비서 공고도 이쪽으로 연결된다)
 * 단일 소스 중 커버리지가 가장 넓다. 목록/상세 모두 서버 렌더라 스크레이핑이 안정적이다.
 *
 * robots.txt 확인: `/sii/` 는 Disallow 대상이 아니다 (2026-08 기준).
 * 공식 오픈 API(공공데이터포털 "기업마당 지원사업정보")로 갈아탈 수도 있으나,
 * 키 없이 바로 동작하는 쪽을 먼저 붙였다.
 *
 * 상세 페이지 구조:
 *   <h2 class="title">공고 제목</h2>
 *   <div class="view_cont"><ul>
 *     <li><span class="s_title">신청기간</span><div class="txt">2026.08.03 ~ 2026.08.18</div></li>
 *     ...
 *   </ul></div>
 * 라벨(span.s_title) → 값(div.txt) 매핑이라 항목 순서가 바뀌어도 깨지지 않는다.
 */

const LIST_PATH = "/sii/siia/selectSIIA200View.do";
const DETAIL_PATH = "/sii/siia/selectSIIA200Detail.do";

/** 상세 요청 간격 — 공용 사이트이므로 과하게 두드리지 않는다 */
const REQUEST_DELAY_MS = 350;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      // 기본 fetch UA 는 차단되는 경우가 많다
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) gov-biz-curator/0.1",
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`기업마당 요청 실패 (HTTP ${response.status}): ${url}`);
  }
  return response.text();
}

function detailUrl(pblancId: string): string {
  return `${env.bizinfoBaseUrl()}${DETAIL_PATH}?pblancId=${pblancId}`;
}

/** 목록 페이지에서 공고 ID 만 뽑는다. 나머지는 상세에서 읽는 편이 정확하다. */
async function fetchPblancIds(page: number, rows: number): Promise<string[]> {
  const url = `${env.bizinfoBaseUrl()}${LIST_PATH}?cpage=${page}&rows=${rows}`;
  const $ = cheerio.load(await fetchHtml(url));

  const ids = new Set<string>();
  $('a[href*="pblancId="]').each((_, element) => {
    const href = $(element).attr("href");
    const matched = href?.match(/pblancId=(PBLN_[0-9]+)/);
    if (matched?.[1]) ids.add(matched[1]);
  });

  return [...ids];
}

/** `[경기] 화성시 …` 처럼 제목 앞에 붙는 지역 표기를 뽑아낸다 */
function extractRegion(title: string): string | null {
  const matched = title.match(/^\s*\[([^\]]{2,10})\]/);
  const candidate = matched?.[1]?.trim();
  if (!candidate) return null;
  // [모집공고] 같은 비지역 태그는 걸러낸다
  return /공고|모집|재공고|연장|변경/.test(candidate) ? null : candidate;
}

/**
 * 소관부처·지자체 값을 지역으로 환산한다 ("충청북도" → "충북").
 * 지자체 공고는 제목에 [지역] 이 안 붙는 경우가 많은데 이 칸은 거의 항상 차 있다.
 * 부처 이름(문화체육관광부 등)은 어디에도 걸리지 않아 null 이 된다.
 */
const SIDO: readonly (readonly [alias: string, region: string])[] = [
  ["서울", "서울"],
  ["부산", "부산"],
  ["대구", "대구"],
  ["인천", "인천"],
  ["광주", "광주"],
  ["대전", "대전"],
  ["울산", "울산"],
  ["세종", "세종"],
  ["경기", "경기"],
  ["강원", "강원"],
  ["제주", "제주"],
  ["충청북도", "충북"],
  ["충청남도", "충남"],
  ["전라북도", "전북"],
  ["전라남도", "전남"],
  ["경상북도", "경북"],
  ["경상남도", "경남"],
  ["충북", "충북"],
  ["충남", "충남"],
  ["전북", "전북"],
  ["전남", "전남"],
  ["경북", "경북"],
  ["경남", "경남"],
];

function toRegion(value: string | null): string | null {
  if (!value) return null;
  return SIDO.find(([alias]) => value.includes(alias))?.[1] ?? null;
}

/**
 * 기업마당 사업개요는 `☞ 대상` → `☞ 지원내용` 순서로 쓰는 관례가 있다.
 * 첫 ☞ 줄을 지원대상으로 본다. AI 요건 검토가 이 값을 크게 쓰므로 채워 두는 게 좋다.
 */
function extractTargetAudience(content: string): string | null {
  const line = content
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("☞"));

  const value = line?.replace(/^☞\s*/, "").trim();
  return value && value.length >= 4 ? value : null;
}

/** "2026.08.03 ~ 2026.08.18" / "예산 소진시까지" 등 */
function parsePeriod(value: string | null): {
  startDate: Date | null;
  endDate: Date | null;
} {
  if (!value) return { startDate: null, endDate: null };
  const [rawStart, rawEnd] = value.split("~");
  return {
    startDate: parseKoreanDate(rawStart ?? null),
    endDate: parseKoreanDate(rawEnd ?? null),
  };
}

async function fetchDetail(pblancId: string): Promise<RawAnnouncement | null> {
  const url = detailUrl(pblancId);
  const $ = cheerio.load(await fetchHtml(url));

  const title = normalizeWhitespace($("h2.title").first().text());
  if (!title) return null;

  // 라벨 → 값 매핑
  const fields = new Map<string, { text: string; html: string }>();
  $(".view_cont li").each((_, element) => {
    const label = normalizeWhitespace(
      $(element).find(".s_title").first().text(),
    );
    if (!label) return;
    const $value = $(element).find(".txt").first();
    fields.set(label, {
      text: normalizeWhitespace($value.text()),
      html: $value.html() ?? "",
    });
  });

  const pick = (...labels: string[]): string | null => {
    for (const label of labels) {
      const found = fields.get(label);
      if (found?.text) return found.text;
    }
    return null;
  };

  const overviewHtml = fields.get("사업개요")?.html ?? "";
  const content =
    normalizeWhitespace(stripHtml(overviewHtml)) || pick("사업개요") || title;

  // 지원분야(금융·기술·인력·수출·내수·창업·경영·기타)는 라벨 목록이 아니라 제목 위 배지에 있다
  const category =
    normalizeWhitespace(
      $("h2.title").parent().find(".category").first().text(),
    ) || pick("사업분류", "지원분야");

  const attachments: RawAttachment[] = [];
  $('a[href*="fileDown.do"]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const fileName = normalizeWhitespace($(element).text()) || "attachment";
    attachments.push({
      fileName,
      fileUrl: new URL(href, env.bizinfoBaseUrl()).toString(),
    });
  });

  const { startDate, endDate } = parsePeriod(pick("신청기간"));

  return {
    source: "BIZINFO",
    externalId: pblancId,
    title,
    content,
    url,
    category,
    region:
      extractRegion(title) ?? toRegion(pick("소관부처·지자체", "소관부처")),
    targetAudience:
      pick("지원대상", "신청대상") ?? extractTargetAudience(content),
    agency: pick("사업수행기관", "소관부처·지자체", "소관부처"),
    startDate,
    endDate,
    attachments,
  };
}

export const bizinfoAdapter: AnnouncementSourceAdapter = {
  source: "BIZINFO",
  label: "기업마당(bizinfo)",

  // 공개 사이트라 별도 키가 필요 없다
  isConfigured: () => Boolean(env.bizinfoBaseUrl()),

  async fetchAnnouncements(options: FetchOptions = {}) {
    const rows = options.pageSize ?? 15;
    const maxPages = options.maxPages ?? 2;
    const collected: RawAnnouncement[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= maxPages; page += 1) {
      const ids = await fetchPblancIds(page, rows);
      if (ids.length === 0) {
        console.warn(
          `[bizinfo] 목록에서 공고 ID 를 찾지 못했습니다. 마크업이 바뀌었을 수 있습니다 (page=${page})`,
        );
        break;
      }

      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);

        await sleep(REQUEST_DELAY_MS);
        try {
          const announcement = await fetchDetail(id);
          if (announcement) collected.push(announcement);
        } catch (error) {
          console.warn(`[bizinfo] 상세 수집 실패: ${id}`, error);
        }
      }
    }

    return collected;
  },
};

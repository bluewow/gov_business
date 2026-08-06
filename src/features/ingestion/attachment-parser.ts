import { strFromU8, unzipSync } from "fflate";

import type { ParseStatus } from "@/db/schema";
import { normalizeWhitespace } from "@/lib/text";

/**
 * 첨부파일 텍스트 추출 레이어.
 *
 * 정부지원사업은 본문이 거의 비어 있고 HWP/PDF 첨부에만 실질 내용이 있는 경우가 많다.
 * 여기서 뽑아낸 텍스트가 AI 요건 검토·초안 작성의 근거가 된다.
 *
 * 비용 메모: 추출 자체는 전부 로컬 연산이라 API 비용이 0 이다.
 * 다만 파일을 내려받아야 하므로(건당 수백 KB) 전체 공고를 일괄 처리하지 않고
 * 사용자가 지원서 상세에서 요청할 때만 돌린다.
 */

export interface AttachmentParseResult {
  status: ParseStatus;
  text: string | null;
  /** Content-Disposition 에서 얻은 실제 파일명 (목록의 "다운로드" 를 대체) */
  fileName?: string;
  error?: string;
}

export interface AttachmentParser {
  name: string;
  supports(input: { fileName: string; mimeType?: string | null }): boolean;
  parse(input: {
    fileName: string;
    mimeType?: string | null;
    buffer: Uint8Array;
  }): Promise<string>;
}

const parsers: AttachmentParser[] = [];

export function registerParser(parser: AttachmentParser): void {
  parsers.push(parser);
}

/** 확장자 추출 (소문자, 점 제외) */
export function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index === -1 ? "" : fileName.slice(index + 1).toLowerCase();
}

// ── 파서 ────────────────────────────────────────────────────────

const PLAIN_TEXT_EXTENSIONS = new Set(["txt", "md", "csv"]);

registerParser({
  name: "plain-text",
  supports: ({ fileName, mimeType }) =>
    PLAIN_TEXT_EXTENSIONS.has(fileExtension(fileName)) ||
    Boolean(mimeType?.startsWith("text/")),
  parse: async ({ buffer }) => new TextDecoder("utf-8").decode(buffer),
});

/**
 * HWPX — 한글 2014 이후의 표준 포맷. zip 안에 XML 이 들어 있어 외부 뷰어 없이 읽힌다.
 * 본문은 Contents/sectionN.xml 에 있고 태그를 걷어내면 텍스트가 남는다.
 * (구형 .hwp 는 바이너리 포맷이라 별도 라이브러리가 필요하다 — 아직 미지원)
 */
registerParser({
  name: "hwpx",
  supports: ({ fileName }) => fileExtension(fileName) === "hwpx",
  parse: async ({ buffer }) => {
    const files = unzipSync(buffer);
    const sections = Object.keys(files)
      .filter((path) => /^Contents\/section\d+\.xml$/i.test(path))
      .sort();

    if (sections.length === 0) {
      throw new Error(
        "HWPX 안에서 본문(Contents/sectionN.xml)을 찾지 못했습니다.",
      );
    }

    return (
      sections
        .map((path) => strFromU8(files[path]!))
        .join("\n")
        // 문단·줄 구분 태그는 줄바꿈으로 살리고 나머지는 제거한다
        .replace(/<\/hp:p>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    );
  },
});

/**
 * HWP — 한글 5.0 바이너리(CFB) 포맷. 수집된 첨부 중 가장 많은 확장자다.
 * 파싱이 무거워 필요할 때만 로드한다.
 */
registerParser({
  name: "hwp",
  supports: ({ fileName }) => fileExtension(fileName) === "hwp",
  parse: async ({ buffer }) => {
    const { extractHwpText } = await import("./hwp-text");
    return extractHwpText(buffer);
  },
});

/** PDF — unpdf(pdf.js) 로 텍스트 레이어를 뽑는다. 스캔본(이미지)은 빈 텍스트가 나온다. */
registerParser({
  name: "pdf",
  supports: ({ fileName, mimeType }) =>
    fileExtension(fileName) === "pdf" || mimeType === "application/pdf",
  parse: async ({ buffer }) => {
    // pdf.js 는 무거워서 필요할 때만 로드한다
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buffer);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : String(text);
  },
});

/**
 * ZIP — 「2026년…지원사업 공고문+붙임.zip」처럼 공고문 자체가 압축 안에 들어 있는 경우가 있다.
 * 안의 파일을 다시 각 파서에 태운다. 중첩 zip 은 열지 않는다(재귀 폭탄 방지).
 */
const MAX_ZIP_ENTRIES = 20;

registerParser({
  name: "zip",
  supports: ({ fileName }) => fileExtension(fileName) === "zip",
  parse: async ({ buffer }) => {
    const files = unzipSync(buffer);
    const texts: string[] = [];

    for (const [path, content] of Object.entries(files).slice(
      0,
      MAX_ZIP_ENTRIES,
    )) {
      const name = path.split("/").pop() ?? path;
      const extension = fileExtension(name);
      if (!extension || extension === "zip") continue;

      const parser = parsers.find(
        (candidate) =>
          candidate.name !== "zip" && candidate.supports({ fileName: name }),
      );
      if (!parser) continue;

      try {
        const text = await parser.parse({ fileName: name, buffer: content });
        if (text.trim()) texts.push(`[${name}]\n${text}`);
      } catch {
        // 한 파일이 깨져도 나머지는 살린다
      }
    }

    if (texts.length === 0) {
      throw new Error("압축 안에서 읽을 수 있는 문서를 찾지 못했습니다.");
    }
    return texts.join("\n\n");
  },
});

// ── 다운로드 ────────────────────────────────────────────────────

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * Content-Disposition 에서 실제 파일명을 뽑는다.
 *
 * fetch 의 헤더 값은 바이트를 latin-1 로 읽은 문자열이라, 한글 파일명이 깨져 들어온다.
 * UTF-8 로 다시 디코딩해야 "글로벌_무역데이터…" 처럼 제대로 나온다.
 */
export function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;

  // filename* 를 우선하되, 없으면 filename 을 쓴다
  const raw =
    value.match(/filename\*=([^;]+)/i)?.[1] ??
    value.match(/filename=([^;]+)/i)?.[1];
  if (!raw) return null;

  return decodeFilename(raw) || null;
}

/**
 * 실제로 만난 표기 3종을 모두 처리한다.
 *   filename="붙임1. 공고문.pdf"                       ← latin-1 로 읽혀 깨진 UTF-8
 *   filename*=UTF-8''%ED%95%9C%EA%B8%80.hwpx           ← 표준 RFC 5987
 *   filename*="UTF-8''%ED%95%9C%EA%B8%80.png"          ← 따옴표까지 두른 변형
 */
function decodeFilename(value: string): string {
  // 1) 따옴표 → 2) UTF-8'' 접두어 순으로 걷어낸다 (순서가 바뀌면 접두어가 남는다)
  const unwrapped = value
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/^UTF-8''/i, "");

  if (/%[0-9A-Fa-f]{2}/.test(unwrapped)) {
    try {
      return decodeURIComponent(unwrapped).trim();
    } catch {
      return unwrapped.trim();
    }
  }

  // 퍼센트 인코딩이 아니면, 헤더가 바이트를 latin-1 로 읽어 한글이 깨진 경우다
  const repaired = Buffer.from(unwrapped, "latin1").toString("utf8");
  return (repaired.includes("�") ? unwrapped : repaired).trim();
}

export async function parseAttachment(input: {
  fileName: string;
  fileUrl: string;
  mimeType?: string | null;
}): Promise<AttachmentParseResult> {
  let resolvedName = input.fileName;

  try {
    const response = await fetch(input.fileUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) gov-biz-curator/0.1",
        // Referer 가 없으면 정부 사이트가 파일 대신 에러 HTML 을 준다
        Referer: new URL(input.fileUrl).origin,
      },
      cache: "no-store",
      // 파일이 커서 목록·상세보다 넉넉히 준다
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      return {
        status: "FAILED",
        text: null,
        error: `다운로드 실패 (HTTP ${response.status})`,
      };
    }

    // 목록의 링크 텍스트("다운로드")보다 헤더의 실제 파일명이 정확하다
    resolvedName =
      filenameFromDisposition(response.headers.get("content-disposition")) ??
      input.fileName;

    const contentType = response.headers.get("content-type");
    const buffer = new Uint8Array(await response.arrayBuffer());

    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      return {
        status: "FAILED",
        text: null,
        fileName: resolvedName,
        error: `파일이 너무 큽니다 (${Math.round(buffer.byteLength / 1024 / 1024)}MB)`,
      };
    }

    const parser = parsers.find((candidate) =>
      candidate.supports({ fileName: resolvedName, mimeType: contentType }),
    );

    if (!parser) {
      return {
        status: "UNSUPPORTED",
        text: null,
        fileName: resolvedName,
        error: `.${fileExtension(resolvedName) || "?"} 를 처리할 파서가 없습니다.`,
      };
    }

    const raw = await parser.parse({
      fileName: resolvedName,
      mimeType: contentType,
      buffer,
    });
    const text = normalizeWhitespace(raw);

    if (!text) {
      return {
        status: "FAILED",
        text: null,
        fileName: resolvedName,
        // 스캔 PDF 처럼 텍스트 레이어가 없는 경우
        error: "추출된 텍스트가 없습니다 (이미지 기반 문서일 수 있습니다).",
      };
    }

    return { status: "PARSED", text, fileName: resolvedName };
  } catch (error) {
    return {
      status: "FAILED",
      text: null,
      fileName: resolvedName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

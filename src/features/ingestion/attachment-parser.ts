import type { ParseStatus } from "@/db/schema";

/**
 * 첨부파일 텍스트 추출 레이어.
 *
 * 정부지원사업은 본문이 거의 비어 있고 HWP/PDF 첨부에만 실질 내용이 있는 경우가 많다.
 * 여기서 뽑아낸 텍스트를 Announcement.content 에 합쳐야 추천 정밀도가 올라간다.
 *
 * ⚠️ 초안 상태: PDF/HWP 파서는 아직 미구현이다. 붙일 때 후보는 아래와 같다.
 *   - PDF : `pdf-parse` / `unpdf` (서버 런타임 nodejs 필요)
 *   - HWP : `hwp.js` (한계 있음) 또는 LibreOffice(soffice) 변환 후 텍스트 추출
 *   - HWPX: zip + XML 파싱으로 비교적 쉬움 — 여기부터 붙이는 것을 권장
 * 파서를 추가하면 registerParser 로 등록만 하면 파이프라인이 자동으로 사용한다.
 */

export interface AttachmentParseResult {
  status: ParseStatus;
  text: string | null;
  error?: string;
}

export interface AttachmentParser {
  name: string;
  /** 이 파서가 처리할 수 있는 파일인지 */
  supports(input: { fileName: string; mimeType?: string | null }): boolean;
  parse(input: {
    fileName: string;
    mimeType?: string | null;
    buffer: ArrayBuffer;
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

const PLAIN_TEXT_EXTENSIONS = new Set(["txt", "md", "csv"]);

/** 별도 의존성 없이 처리 가능한 텍스트 파일용 기본 파서 */
registerParser({
  name: "plain-text",
  supports: ({ fileName, mimeType }) =>
    PLAIN_TEXT_EXTENSIONS.has(fileExtension(fileName)) ||
    Boolean(mimeType?.startsWith("text/")),
  parse: async ({ buffer }) => new TextDecoder("utf-8").decode(buffer),
});

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB

export async function parseAttachment(input: {
  fileName: string;
  fileUrl: string;
  mimeType?: string | null;
}): Promise<AttachmentParseResult> {
  const parser = parsers.find((candidate) =>
    candidate.supports({ fileName: input.fileName, mimeType: input.mimeType }),
  );

  if (!parser) {
    return {
      status: "UNSUPPORTED",
      text: null,
      error: `.${fileExtension(input.fileName) || "?"} 를 처리할 파서가 없습니다.`,
    };
  }

  try {
    const response = await fetch(input.fileUrl);
    if (!response.ok) {
      return {
        status: "FAILED",
        text: null,
        error: `다운로드 실패 (HTTP ${response.status})`,
      };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      return {
        status: "FAILED",
        text: null,
        error: `파일이 너무 큽니다 (${Math.round(buffer.byteLength / 1024 / 1024)}MB)`,
      };
    }

    const text = await parser.parse({
      fileName: input.fileName,
      mimeType: input.mimeType,
      buffer,
    });

    return { status: "PARSED", text };
  } catch (error) {
    return {
      status: "FAILED",
      text: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

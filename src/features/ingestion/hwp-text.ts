import * as CFB from "cfb";
import { inflateSync } from "fflate";

/**
 * 구형 HWP(한글 5.0) 본문 텍스트 추출.
 *
 * hwpx 와 달리 zip+XML 이 아니라 **CFB(OLE2) 바이너리 컨테이너**다.
 * 수집된 첨부의 최대 단일 확장자가 `.hwp` 라(292건, 공고 55건이 이것뿐) 이걸 못 읽으면
 * 그 공고들은 자격요건을 통째로 알 수 없다.
 *
 * 구조:
 *   FileHeader          32바이트 시그니처 + 버전 + 속성 플래그(압축 여부가 bit 0)
 *   BodyText/SectionN   구역별 본문. 압축돼 있으면 zlib 헤더 없는 raw deflate 다
 *     └ 레코드 스트림   4바이트 헤더(tagID 10bit · level 10bit · size 12bit) + 페이로드
 *          tagID 67 = HWPTAG_PARA_TEXT → UTF-16LE 문단 텍스트
 *
 * 표·글상자 안의 글자도 같은 PARA_TEXT 레코드로 들어오므로 함께 뽑힌다.
 */

/** HWPTAG_BEGIN(0x10) + 51 — 문단 텍스트 레코드 */
const HWPTAG_PARA_TEXT = 67;

/** 파일 속성 플래그: bit 0 이 서면 BodyText 스트림이 압축돼 있다 */
const COMPRESSED_FLAG = 0x01;

/**
 * 본문에 섞여 오는 제어 문자 중 **8 WCHAR 를 통째로 차지하는** 것들.
 * (표·그림·각주 같은 개체 참조. 시작/끝 코드 사이에 6 WCHAR 의 정보가 들어 있다)
 * 이걸 건너뛰지 않으면 개체 정보가 깨진 글자로 본문에 섞인다.
 */
const EXTENDED_CONTROLS = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23,
]);

/** 레코드 헤더 하나를 읽는다 */
function readRecordHeader(
  view: DataView,
  offset: number,
): { tagId: number; size: number; headerSize: number } {
  const value = view.getUint32(offset, true);
  const tagId = value & 0x3ff;
  let size = (value >> 20) & 0xfff;
  let headerSize = 4;

  // size 가 최대값이면 실제 크기는 뒤따르는 4바이트에 있다
  if (size === 0xfff) {
    size = view.getUint32(offset + 4, true);
    headerSize = 8;
  }

  return { tagId, size, headerSize };
}

/** PARA_TEXT 페이로드(UTF-16LE + 제어문자)를 사람이 읽는 텍스트로 */
function decodeParaText(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chars: string[] = [];

  for (let index = 0; index + 1 < bytes.byteLength; index += 2) {
    const code = view.getUint16(index, true);

    if (code >= 32) {
      chars.push(String.fromCharCode(code));
      continue;
    }

    if (EXTENDED_CONTROLS.has(code)) {
      // 8 WCHAR = 16바이트를 통째로 건너뛴다 (자기 자신 2바이트는 루프가 더한다)
      index += 14;
      chars.push(" ");
      continue;
    }

    // 9 탭 / 10 줄바꿈 / 13 문단 끝 — 나머지 단일 제어문자는 버린다
    if (code === 9) chars.push("\t");
    else if (code === 10 || code === 13) chars.push("\n");
  }

  return chars.join("");
}

/** 압축돼 있으면 풀고, 아니면 그대로 */
function decompress(stream: Uint8Array, compressed: boolean): Uint8Array {
  if (!compressed) return stream;
  // zlib 헤더가 없는 raw deflate 다
  return inflateSync(stream);
}

/**
 * 레코드 스트림을 훑어 PARA_TEXT 만 모은다.
 * 알 수 없는 태그는 크기만큼 건너뛰므로 포맷이 조금 달라도 멈추지 않는다.
 */
function extractSectionText(section: Uint8Array): string {
  const view = new DataView(
    section.buffer,
    section.byteOffset,
    section.byteLength,
  );
  const parts: string[] = [];

  let offset = 0;
  while (offset + 4 <= section.byteLength) {
    const { tagId, size, headerSize } = readRecordHeader(view, offset);
    const start = offset + headerSize;
    const end = start + size;
    if (end > section.byteLength) break;

    if (tagId === HWPTAG_PARA_TEXT) {
      parts.push(decodeParaText(section.subarray(start, end)));
    }

    offset = end;
  }

  return parts.join("\n");
}

export function extractHwpText(buffer: Uint8Array): string {
  const container = CFB.read(buffer, { type: "buffer" });

  const header = CFB.find(container, "FileHeader");
  if (!header?.content) {
    throw new Error(
      "HWP FileHeader 를 찾지 못했습니다 (손상되었거나 다른 포맷).",
    );
  }

  const headerBytes = Uint8Array.from(header.content as ArrayLike<number>);
  const signature = new TextDecoder("ascii").decode(
    headerBytes.subarray(0, 17),
  );
  if (!signature.startsWith("HWP Document File")) {
    throw new Error(`HWP 시그니처가 아닙니다: ${signature.slice(0, 17)}`);
  }

  // 32바이트 시그니처 + 4바이트 버전 다음이 속성 플래그다
  const compressed =
    (new DataView(
      headerBytes.buffer,
      headerBytes.byteOffset,
      headerBytes.byteLength,
    ).getUint32(36, true) &
      COMPRESSED_FLAG) !==
    0;

  // Section0, Section1… 을 번호순으로 (문자열 정렬이면 Section10 이 Section2 앞에 온다)
  const sections = container.FileIndex.filter(
    (entry) =>
      /BodyText\/Section\d+$/i.test(entry.name) ||
      /^Section\d+$/i.test(entry.name),
  ).sort((a, b) => {
    const order = (name: string) => Number(name.match(/(\d+)$/)?.[1] ?? 0);
    return order(a.name) - order(b.name);
  });

  if (sections.length === 0) {
    throw new Error("HWP 안에서 본문(BodyText/SectionN)을 찾지 못했습니다.");
  }

  return sections
    .map((entry) => {
      const raw = Uint8Array.from(entry.content as ArrayLike<number>);
      return extractSectionText(decompress(raw, compressed));
    })
    .join("\n");
}

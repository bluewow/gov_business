/**
 * AI 요건 검토·초안 작성을 실행해도 되는 상태인지.
 *
 * 자격요건은 첨부 공고문에만 적혀 있는 경우가 대부분이라, 첨부를 두고도 추출하지 않은 채
 * 검토를 돌리면 공고 본문(평균 87~320자)만 보고 판단하게 된다. 그 결과는 그럴듯하지만
 * 근거가 없다. 그래서 "첨부가 있는데 하나도 추출되지 않은" 상태에서는 실행을 막는다.
 *
 * 첨부가 아예 없는 공고(K-Startup 등)는 막지 않는다 — 막으면 영영 실행할 수 없다.
 * 순수 함수라 클라이언트 컴포넌트에서 그대로 쓴다.
 */
export interface AttachmentReadinessInput {
  parseStatus: string;
  useForAi: boolean;
  extractedText: string | null;
}

export interface AiReadiness {
  /** 실행 가능 여부 */
  ready: boolean;
  /** 막힌 이유 또는 주의 문구 */
  notice?: string;
}

export function checkAiReadiness(
  attachments: AttachmentReadinessInput[],
): AiReadiness {
  if (attachments.length === 0) {
    return {
      ready: true,
      notice: "첨부가 없어 공고 본문만 근거로 판단합니다.",
    };
  }

  const parsed = attachments.filter((item) => item.parseStatus === "PARSED");
  if (parsed.length === 0) {
    return {
      ready: false,
      notice:
        "먼저 위에서 첨부 본문을 추출하세요. 자격요건은 대부분 첨부 공고문에만 적혀 있어, 추출 전에는 근거 없는 판단이 나옵니다.",
    };
  }

  const selected = parsed.filter((item) => item.useForAi && item.extractedText);
  if (selected.length === 0) {
    return {
      ready: true,
      notice:
        "AI 에 넘길 첨부를 하나도 선택하지 않아 공고 본문만으로 판단합니다.",
    };
  }

  return { ready: true };
}

/**
 * 정부지원사업 사업계획서 표준 목차(PSST).
 * K-Startup 계열 공고 대부분이 이 4단 구성을 요구한다.
 * 공고마다 세부 항목이 다르므로 여기는 "기본 틀"이고, 필요하면 섹션을 추가해 쓴다.
 */
export interface DraftSection {
  key: string;
  title: string;
  /** LLM 에게 넘길 작성 지침 — 실제 심사 관점을 반영한다 */
  guide: string;
  order: number;
}

export const DRAFT_SECTIONS: DraftSection[] = [
  {
    key: "problem",
    title: "1. 문제인식 (Problem)",
    order: 1,
    guide:
      "창업 아이템의 배경과 필요성. 어떤 고객의 어떤 불편을 다루는지, 그 문제가 왜 지금 중요한지를 시장 근거와 함께 쓴다. 목표 시장과 고객 세그먼트를 명확히 특정할 것.",
  },
  {
    key: "solution",
    title: "2. 실현가능성 (Solution)",
    order: 2,
    guide:
      "해결 방안과 개발 계획. 제품/서비스의 핵심 기능, 현재 개발 단계, 협약 기간 내 달성할 마일스톤, 기술적 차별점을 쓴다. 경쟁 서비스 대비 우위를 구체적으로.",
  },
  {
    key: "scale-up",
    title: "3. 성장전략 (Scale-up)",
    order: 3,
    guide:
      "사업화 전략과 자금 운용 계획. 목표 매출/고객 확보 계획, 유통·마케팅 경로, 지원금 사용 계획(항목별 배분), 사업 확장 로드맵을 쓴다.",
  },
  {
    key: "team",
    title: "4. 팀 구성 (Team)",
    order: 4,
    guide:
      "대표자와 팀원의 역량이 이 아이템을 수행하기에 적합한 이유. 보유 경력·기술·네트워크, 부족한 역량을 어떻게 보완할지(채용/외주/멘토링) 쓴다.",
  },
];

export function getSection(key: string): DraftSection | undefined {
  return DRAFT_SECTIONS.find((section) => section.key === key);
}

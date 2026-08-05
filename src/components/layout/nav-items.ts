import type { LucideIcon } from "lucide-react";
import {
  Building2,
  DownloadCloud,
  FileText,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  Sparkles,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export interface NavGroup {
  /** 흐름상의 단계 번호. 개요·설정 그룹은 null. */
  step: number | null;
  title: string;
  items: NavItem[];
}

/**
 * 사이드바 = 서비스의 진행 순서.
 * 사업 등록 → 공고 수집 → 맞춤 추천 → 지원서 검토·작성 순으로 읽히도록 구성한다.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    step: null,
    title: "개요",
    items: [
      {
        href: "/",
        label: "대시보드",
        description: "단계별 진행 현황",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    step: 1,
    title: "내 사업",
    items: [
      {
        href: "/business",
        label: "사업 프로필",
        description: "추천의 기준이 되는 사업 설명",
        icon: Building2,
      },
    ],
  },
  {
    step: 2,
    title: "공고 수집",
    items: [
      {
        href: "/ingestion",
        label: "수집 현황",
        description: "소스 상태 · 수동 수집 · 실행 이력",
        icon: DownloadCloud,
      },
      {
        href: "/announcements",
        label: "공고 목록",
        description: "수집된 전체 공고 탐색",
        icon: ListFilter,
      },
    ],
  },
  {
    step: 3,
    title: "맞춤 추천",
    items: [
      {
        href: "/recommendations",
        label: "큐레이션",
        description: "내 사업과 연관도 높은 공고",
        icon: Sparkles,
      },
    ],
  },
  {
    step: 4,
    title: "지원서",
    items: [
      {
        href: "/applications",
        label: "지원 관리",
        description: "AI 요건 검토 · 사업계획서 초안",
        icon: FileText,
      },
    ],
  },
  {
    step: null,
    title: "설정",
    items: [
      {
        // 키는 STEP 2·3·4 어디서나 필요하므로 특정 단계에 묶지 않는다
        href: "/settings/api-keys",
        label: "API 키",
        description: "공공데이터 · OpenAI 키 입력",
        icon: KeyRound,
      },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

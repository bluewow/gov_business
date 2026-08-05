"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { RuntimeKeys } from "@/lib/runtime-keys";

/**
 * 브라우저에서 입력한 API 키.
 *
 * sessionStorage 에만 둔다 — 탭을 닫으면 사라지고, 서버 DB·파일에는 절대 저장되지 않는다.
 * localStorage 가 아닌 이유는 "휘발성"이 요구사항이기 때문. 대신 페이지를 옮겨 다녀도
 * (STEP 2 에서 넣고 STEP 4 에서 쓰는 식) 유지된다.
 *
 * ⚠️ sessionStorage 는 같은 페이지의 스크립트가 읽을 수 있다. 공용 PC 에서는 쓰지 말 것.
 */
interface ApiKeysState {
  dataGoKr: string;
  openai: string;
  setKey: (name: keyof RuntimeKeys, value: string) => void;
  clear: () => void;
}

export const useApiKeysStore = create<ApiKeysState>()(
  persist(
    (set) => ({
      dataGoKr: "",
      openai: "",
      setKey: (name, value) => set({ [name]: value } as Partial<ApiKeysState>),
      clear: () => set({ dataGoKr: "", openai: "" }),
    }),
    {
      name: "gov-biz:api-keys",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        dataGoKr: state.dataGoKr,
        openai: state.openai,
      }),
    },
  ),
);

/**
 * 서버 액션에 실어 보낼 형태로 꺼낸다. 빈 문자열은 undefined 로 바꿔
 * 서버가 .env 로 폴백할 수 있게 한다.
 */
export function useRuntimeKeys(): RuntimeKeys {
  const dataGoKr = useApiKeysStore((state) => state.dataGoKr);
  const openai = useApiKeysStore((state) => state.openai);

  return {
    dataGoKr: dataGoKr.trim() || undefined,
    openai: openai.trim() || undefined,
  };
}

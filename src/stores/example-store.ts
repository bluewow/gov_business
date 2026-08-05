import { create } from "zustand";

interface ExampleState {
  count: number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
}

/**
 * Zustand 스토어 예제.
 * 전역 클라이언트 상태만 여기에 둡니다 (서버 데이터는 TanStack Query 사용).
 */
export const useExampleStore = create<ExampleState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
  reset: () => set({ count: 0 }),
}));

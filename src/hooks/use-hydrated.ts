"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * 클라이언트에서 하이드레이션이 끝났는지.
 *
 * sessionStorage/localStorage 처럼 서버에 없는 값을 그릴 때 쓴다.
 * `useEffect(() => setMounted(true))` 방식은 불필요한 연쇄 렌더를 만들어
 * react-hooks/set-state-in-effect 규칙에 걸리므로 useSyncExternalStore 를 쓴다.
 * (서버 스냅샷은 false, 클라이언트 스냅샷은 true)
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

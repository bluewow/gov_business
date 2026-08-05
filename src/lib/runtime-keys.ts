import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 브라우저에서 입력받아 "그 요청에서만" 쓰는 휘발성 API 키.
 *
 * 왜 AsyncLocalStorage 인가:
 * 키를 쓰는 지점이 어댑터·임베딩·LLM 3곳으로 흩어져 있어 인자로 넘기면 시그니처가 전부 오염된다.
 * 요청 스코프 컨텍스트로 두면 env.ts 한 곳만 고쳐도 전 경로가 키를 인식한다.
 *
 * 저장 정책:
 *  - 서버는 이 값을 DB·파일·로그 어디에도 쓰지 않는다. 요청이 끝나면 사라진다.
 *  - 브라우저는 sessionStorage 에만 둔다(탭을 닫으면 소멸). src/stores/api-keys-store.ts 참고.
 *  - 키가 없으면 .env 값으로 자동 폴백한다 — cron 처럼 사람이 없는 경로가 계속 동작해야 하므로.
 */
export interface RuntimeKeys {
  /** 공공데이터포털 서비스키 (K-Startup 등) */
  dataGoKr?: string;
  /** OpenAI API 키 (임베딩 · LLM 평가 · 초안 작성) */
  openai?: string;
}

const storage = new AsyncLocalStorage<RuntimeKeys>();

/** 서버 액션 본문을 이 안에서 실행하면 하위 호출이 모두 같은 키를 본다 */
export function withRuntimeKeys<T>(
  keys: RuntimeKeys | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!keys || (!keys.dataGoKr && !keys.openai)) return run();
  return storage.run(normalize(keys), run);
}

/** 현재 요청에 실린 키. 없으면 undefined 이고 호출부가 env 로 폴백한다. */
export function runtimeKey(name: keyof RuntimeKeys): string | undefined {
  return storage.getStore()?.[name];
}

function normalize(keys: RuntimeKeys): RuntimeKeys {
  const trim = (value?: string) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  return { dataGoKr: trim(keys.dataGoKr), openai: trim(keys.openai) };
}

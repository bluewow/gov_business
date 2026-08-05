"use client";

import { Check, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/hooks/use-hydrated";
import type { RuntimeKeys } from "@/lib/runtime-keys";
import { useApiKeysStore } from "@/stores/api-keys-store";

export interface ApiKeyFallback {
  /** 서버 .env 에 해당 키가 있는지 — 값은 절대 내려보내지 않고 존재 여부만 */
  dataGoKr: boolean;
  openai: boolean;
}

interface Field {
  name: keyof RuntimeKeys;
  label: string;
  hint: string;
  placeholder: string;
}

const FIELDS: Field[] = [
  {
    name: "dataGoKr",
    label: "공공데이터포털 서비스키",
    hint: "K-Startup 공고 수집에 사용합니다. 포털의 「일반 인증키」를 인코딩·디코딩 어느 쪽으로 넣어도 됩니다.",
    placeholder: "data.go.kr 에서 발급받은 서비스키",
  },
  {
    name: "openai",
    label: "OpenAI API 키",
    hint: "임베딩·추천 정밀평가·지원서 검토/초안 작성에 사용합니다.",
    placeholder: "sk-...",
  },
];

export function ApiKeysPanel({ fallback }: { fallback: ApiKeyFallback }) {
  // zustand v5 는 셀렉터 결과를 참조 비교하므로 객체를 새로 만들어 반환하면 무한 렌더가 난다.
  // 필드마다 원시값으로 따로 구독한다.
  const dataGoKr = useApiKeysStore((state) => state.dataGoKr);
  const openai = useApiKeysStore((state) => state.openai);
  const values: Record<keyof RuntimeKeys, string> = { dataGoKr, openai };
  const setKey = useApiKeysStore((state) => state.setKey);
  const clear = useApiKeysStore((state) => state.clear);

  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  // persist 미들웨어가 마운트 뒤에 sessionStorage 를 읽으므로 SSR 결과와 어긋난다.
  // 실제 값은 하이드레이션 후에만 그린다.
  const mounted = useHydrated();

  const hasAny = mounted && Boolean(values.dataGoKr || values.openai);

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">API 키</h2>
              <Badge variant="ghost">이 탭에서만 유지</Badge>
            </div>
            <p className="text-muted-foreground text-xs leading-5">
              입력한 키는 <strong>브라우저 sessionStorage</strong> 에만 남고,
              요청할 때만 서버로 보내 그 요청에서 쓰고 버립니다. DB·파일·로그에
              저장하지 않습니다. 탭을 닫으면 사라집니다.
            </p>
          </div>
          {hasAny ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              지우기
            </Button>
          ) : null}
        </div>

        {FIELDS.map((field) => {
          const value = mounted ? values[field.name] : "";
          const filled = Boolean(value.trim());
          const usingEnv = !filled && fallback[field.name];

          return (
            <div key={field.name} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`key-${field.name}`}>{field.label}</Label>
                {filled ? (
                  <Badge variant="secondary">
                    <Check className="size-3" aria-hidden />
                    입력됨
                  </Badge>
                ) : usingEnv ? (
                  <Badge variant="ghost">서버 .env 값 사용</Badge>
                ) : (
                  <Badge variant="outline">없음</Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  id={`key-${field.name}`}
                  type={revealed[field.name] ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={value}
                  disabled={!mounted}
                  onChange={(event) => setKey(field.name, event.target.value)}
                  placeholder={field.placeholder}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={revealed[field.name] ? "키 숨기기" : "키 보기"}
                  onClick={() =>
                    setRevealed((previous) => ({
                      ...previous,
                      [field.name]: !previous[field.name],
                    }))
                  }
                >
                  {revealed[field.name] ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>

              <p className="text-muted-foreground text-xs leading-5">
                {field.hint}
                {!filled && !fallback[field.name]
                  ? " 지금은 비어 있어 해당 기능이 동작하지 않습니다."
                  : ""}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

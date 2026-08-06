"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useRuntimeKeys } from "@/stores/api-keys-store";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

import { recommendForCurrentBusiness } from "../actions";
import {
  MAX_KEYWORDS,
  hasKeyword,
  normalizeKeywords,
  parseKeywordInput,
} from "../keywords";
import type { KeywordMode, RecommendResult } from "../types";
import { RecommendationList } from "./recommendation-list";

const MODES: { value: KeywordMode; label: string; hint: string }[] = [
  {
    value: "any",
    label: "하나라도 포함",
    hint: "키워드 중 하나만 걸려도 후보에 넣습니다 — 넓게 훑을 때",
  },
  {
    value: "all",
    label: "모두 포함",
    hint: "키워드를 전부 포함한 공고만 후보에 넣습니다 — 좁혀 들어갈 때",
  },
];

export function CurationPanel({
  savedIds,
  defaultKeywords,
  suggestedKeywords,
}: {
  savedIds: string[];
  /** 처음 채워 둘 키워드 — 사업 프로필에 등록한 키워드 */
  defaultKeywords: string[];
  /** 한 번 눌러 추가할 수 있는 후보 (지역·분야·프로필 키워드·설명에서 추출) */
  suggestedKeywords: string[];
}) {
  const router = useRouter();
  const keys = useRuntimeKeys();
  const inputRef = useRef<HTMLInputElement>(null);
  const [keywords, setKeywords] = useState(() =>
    normalizeKeywords(defaultKeywords),
  );
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<KeywordMode>("any");
  const [useLlm, setUseLlm] = useState(false);
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const isFull = keywords.length >= MAX_KEYWORDS;
  const suggestions = normalizeKeywords(suggestedKeywords, 12).filter(
    (keyword) => !hasKeyword(keywords, keyword),
  );

  function addKeywords(input: string) {
    const parsed = parseKeywordInput(input);
    setDraft("");
    if (parsed.length === 0) return;
    setKeywords((previous) => normalizeKeywords([...previous, ...parsed]));
  }

  function removeKeyword(target: string) {
    setKeywords((previous) => previous.filter((keyword) => keyword !== target));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // 빈 입력에서의 Enter 는 막지 않는다 — 그대로 폼 제출(=검색)이 된다
      if (!draft.trim()) return;
      event.preventDefault();
      addKeywords(draft);
      return;
    }
    if (event.key === ",") {
      event.preventDefault();
      addKeywords(draft);
      return;
    }
    if (event.key === "Backspace" && !draft && keywords.length > 0) {
      setKeywords((previous) => previous.slice(0, -1));
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // 입력 중이던 낱말도 키워드로 확정하고 검색한다
    const applied = normalizeKeywords([
      ...keywords,
      ...parseKeywordInput(draft),
    ]);
    setKeywords(applied);
    setDraft("");

    startTransition(async () => {
      const next = await recommendForCurrentBusiness(
        { keywords: applied, keywordMode: mode, useLlm },
        keys,
      );
      setResult(next);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="keyword">탐색 키워드</Label>

          <div
            className="border-input focus-within:border-ring focus-within:ring-ring/50 dark:bg-input/30 flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-transparent px-2 py-1.5 transition-colors focus-within:ring-3"
            onClick={() => inputRef.current?.focus()}
          >
            {keywords.map((keyword) => (
              <span
                key={keyword}
                className="bg-secondary text-secondary-foreground inline-flex h-6 items-center gap-1 rounded-4xl py-0.5 pr-1 pl-2.5 text-xs font-medium"
              >
                {keyword}
                <button
                  type="button"
                  onClick={() => removeKeyword(keyword)}
                  aria-label={`${keyword} 키워드 제거`}
                  className="hover:bg-foreground/10 flex size-4 items-center justify-center rounded-full text-sm leading-none"
                >
                  ×
                </button>
              </span>
            ))}

            <input
              id="keyword"
              ref={inputRef}
              value={draft}
              disabled={isFull}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => addKeywords(draft)}
              placeholder={
                isFull
                  ? `키워드는 최대 ${MAX_KEYWORDS}개까지`
                  : keywords.length === 0
                    ? "예) 창업, AI, 소상공인, 경기"
                    : "키워드 추가"
              }
              className="placeholder:text-muted-foreground min-w-36 flex-1 bg-transparent text-base outline-none disabled:cursor-not-allowed md:text-sm"
            />
          </div>

          <p className="text-muted-foreground text-xs">
            Enter 또는 쉼표로 추가합니다. 제목·본문뿐 아니라
            분야·지역·지원대상·기관 어디에 들어 있어도 찾으므로
            「경기」·「창업」 같은 말도 키워드로 그냥 넣으면 됩니다.{" "}
            <strong className="text-foreground font-medium">
              키워드는 방향을 줄 뿐 걸러내지 않습니다
            </strong>{" "}
            — 키워드가 안 걸려도 내 사업과 의미가 가까운 공고는 「의미 유사」로
            함께 보여줍니다. 이미 지원서에 담아둔 공고는 결과에서 제외됩니다.
          </p>
        </div>

        {suggestions.length > 0 && !isFull ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground mr-0.5 text-xs">
              추천 키워드
            </span>
            {suggestions.map((keyword) => (
              <Button
                key={keyword}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => addKeywords(keyword)}
              >
                + {keyword}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">매칭 방식</span>
          <div className="inline-flex gap-0.5 rounded-lg border p-0.5">
            {MODES.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="xs"
                variant={mode === option.value ? "secondary" : "ghost"}
                aria-pressed={mode === option.value}
                onClick={() => setMode(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <span className="text-muted-foreground text-xs">
            {MODES.find((option) => option.value === mode)?.hint}
          </span>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={useLlm}
            onChange={(event) => setUseLlm(event.target.checked)}
            className="accent-primary mt-0.5 size-4"
          />
          <span className="flex flex-col gap-0.5">
            <span>LLM 정밀 평가 (후보 30건)</span>
            <span className="text-muted-foreground text-xs">
              유사도만으로는 자격 요건(업력·지역·업종)이 맞는지 알 수 없어, 후보
              30건을 LLM 이 보고 적합도 점수·추천 이유를 매긴 뒤 상위만
              보여줍니다. 처음엔 30초쯤 걸리고, 한 번 평가한 공고는 캐시돼
              다음부터 즉시 나옵니다.
            </span>
          </span>
        </label>

        <Button
          type="submit"
          size="lg"
          disabled={isPending}
          className="self-start"
        >
          {isPending ? "분석 중…" : "맞춤 공고 찾기"}
        </Button>
      </form>

      {isPending ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : result ? (
        <RecommendationList result={result} savedIds={savedIds} />
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          키워드를 넣고 「맞춤 공고 찾기」를 눌러 주세요. 결과를 보며 키워드를
          바꿔 가면 원하는 공고에 좁혀 갈 수 있습니다.
        </p>
      )}
    </div>
  );
}

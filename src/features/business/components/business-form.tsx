"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useRuntimeKeys } from "@/stores/api-keys-store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { saveBusiness } from "../actions";

export interface BusinessFormValues {
  id: string | null;
  title: string;
  description: string;
  region: string;
  category: string;
  businessAgeMonth: string;
  keywords: string;
}

const PLACEHOLDER =
  "무엇을 만들고 있는지, 누구의 어떤 문제를 푸는지, 현재 단계(아이디어/MVP/매출 발생)는 어디인지 적어 주세요.\n\n예) 소상공인 대상 AI 매장 관리 SaaS 를 개발 중입니다. 매출·재고 데이터를 자동 분석해 발주량을 추천하고 POS 와 연동해 일 단위 리포트를 제공합니다. 현재 MVP 개발 단계이며 경기도 성남 소재 예비창업자입니다.";

export function BusinessForm({ initial }: { initial: BusinessFormValues }) {
  const keys = useRuntimeKeys();
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof BusinessFormValues>(
    key: K,
    value: BusinessFormValues[K],
  ) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const result = await saveBusiness(
        {
          id: values.id,
          title: values.title,
          description: values.description,
          region: values.region,
          category: values.category,
          businessAgeMonth: values.businessAgeMonth
            ? Number(values.businessAgeMonth)
            : null,
          keywords: values.keywords
            .split(",")
            .map((keyword) => keyword.trim())
            .filter(Boolean),
        },
        keys,
      );

      if (!result.ok) {
        setMessage({
          type: "error",
          text: result.error ?? "저장에 실패했습니다.",
        });
        return;
      }

      setValues((previous) => ({
        ...previous,
        id: result.businessId ?? previous.id,
      }));
      setMessage({
        type: "ok",
        text: result.embedded
          ? "저장하고 임베딩을 갱신했습니다. 이제 맞춤 추천을 받을 수 있습니다."
          : "저장했습니다. (OPENAI_API_KEY 가 없어 임베딩은 건너뛰었습니다 — 추천은 키워드 검색으로 동작합니다)",
      });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="title">사업명</Label>
        <Input
          id="title"
          required
          value={values.title}
          onChange={(event) => update("title", event.target.value)}
          placeholder="AI 매장 관리 SaaS"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">사업 설명</Label>
        <Textarea
          id="description"
          rows={10}
          required
          minLength={30}
          value={values.description}
          onChange={(event) => update("description", event.target.value)}
          placeholder={PLACEHOLDER}
        />
        <p className="text-muted-foreground text-xs">
          이 문장이 그대로 임베딩되어 공고와 비교됩니다. 지원
          자격(업력·지역·업종)이 드러나게 쓰면 AI 검토 단계에서도 정확도가
          올라갑니다. ({values.description.length}자)
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="region">지역</Label>
          <Input
            id="region"
            value={values.region}
            onChange={(event) => update("region", event.target.value)}
            placeholder="경기"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="category">분야</Label>
          <Input
            id="category"
            value={values.category}
            onChange={(event) => update("category", event.target.value)}
            placeholder="창업"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="businessAgeMonth">업력 (개월)</Label>
          <Input
            id="businessAgeMonth"
            type="number"
            min={0}
            value={values.businessAgeMonth}
            onChange={(event) => update("businessAgeMonth", event.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="keywords">키워드 (쉼표로 구분)</Label>
        <Input
          id="keywords"
          value={values.keywords}
          onChange={(event) => update("keywords", event.target.value)}
          placeholder="AI, SaaS, 소상공인, 재고관리"
        />
      </div>

      {message ? (
        <p
          className={
            message.type === "ok"
              ? "rounded-lg border border-dashed p-3 text-sm"
              : "text-destructive border-destructive/30 bg-destructive/5 rounded-lg border p-3 text-sm"
          }
        >
          {message.text}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={isPending}
        className="self-start"
      >
        {isPending
          ? "저장 중…"
          : values.id
            ? "사업 프로필 수정"
            : "사업 프로필 저장"}
      </Button>
    </form>
  );
}

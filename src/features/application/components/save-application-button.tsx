"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { saveApplication } from "../actions";

/** 추천/공고 목록에서 공고를 지원서로 담는 버튼 */
export function SaveApplicationButton({
  announcementId,
  similarity,
  saved,
}: {
  announcementId: string;
  similarity?: number | null;
  /** 서버에서 계산한 초기 담김 여부 */
  saved: boolean;
}) {
  const router = useRouter();
  const [isSaved, setIsSaved] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (isSaved) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        className="text-muted-foreground self-start"
      >
        <Check className="size-3.5" aria-hidden />
        담김
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        className="self-start"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await saveApplication({
              announcementId,
              similarity,
            });
            if (!result.ok) {
              setError(result.error ?? "담기에 실패했습니다.");
              return;
            }
            setIsSaved(true);
            router.refresh();
          })
        }
      >
        {isPending ? "담는 중…" : "지원서에 담기"}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

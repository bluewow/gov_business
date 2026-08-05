"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">문제가 발생했습니다</h1>
        <p className="text-muted-foreground text-sm">
          잠시 후 다시 시도해 주세요.
        </p>
      </div>
      <Button onClick={() => retry()}>다시 시도</Button>
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { ApplicationStatus } from "@/db/schema";

import { removeApplication, updateApplicationStatus } from "../actions";
import { STATUS_LABELS, STATUS_ORDER } from "../status";

export function ApplicationStatusControl({
  applicationId,
  status,
}: {
  applicationId: string;
  status: ApplicationStatus;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="application-status">
        진행 상태
      </label>
      <select
        id="application-status"
        value={current}
        disabled={isPending}
        onChange={(event) => {
          const next = event.target.value as ApplicationStatus;
          setCurrent(next);
          startTransition(async () => {
            await updateApplicationStatus(applicationId, next);
            router.refresh();
          });
        }}
        className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
      >
        {STATUS_ORDER.map((value) => (
          <option key={value} value={value}>
            {STATUS_LABELS[value]}
          </option>
        ))}
      </select>

      {confirming ? (
        <>
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await removeApplication(applicationId);
                router.push("/applications");
              })
            }
          >
            정말 삭제
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
            disabled={isPending}
          >
            취소
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          삭제
        </Button>
      )}
    </div>
  );
}

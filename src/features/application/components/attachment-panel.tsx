"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { extractApplicationAttachments } from "../actions";
import type { ApplicationDetail } from "../api/application-queries";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "미추출",
  PARSED: "추출 완료",
  UNSUPPORTED: "미지원 형식",
  FAILED: "실패",
};

/**
 * 공고 첨부파일 본문 추출.
 *
 * 전체 공고를 일괄 처리하면 수백 MB 를 정부 서버에서 받아야 해서,
 * 실제로 지원할 공고에 한해 사용자가 버튼을 눌렀을 때만 받는다.
 */
export function AttachmentPanel({
  application,
}: {
  application: ApplicationDetail;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const attachments = application.announcement.attachments;
  const parsed = attachments.filter(
    (item) => item.parseStatus === "PARSED",
  ).length;

  if (attachments.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">공고 첨부파일</h2>
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          이 공고에는 첨부파일이 없습니다.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">공고 첨부파일</h2>
          <p className="text-muted-foreground text-xs leading-5">
            자격요건이 첨부 공고문에만 적힌 경우가 많습니다. 본문을 추출하면
            아래 AI 요건 검토·초안 작성이 그 내용을 근거로 판단합니다.
          </p>
        </div>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const result = await extractApplicationAttachments(
                application.id,
              );
              setMessage(
                result.ok
                  ? `첨부 ${result.total}건 중 ${result.parsed}건에서 본문을 추출했습니다. 이제 AI 검토를 다시 실행하면 반영됩니다.`
                  : (result.error ?? "추출에 실패했습니다."),
              );
              router.refresh();
            });
          }}
        >
          {isPending
            ? "추출 중…"
            : parsed > 0
              ? "다시 추출"
              : `첨부 ${attachments.length}건 본문 추출`}
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {attachments.map((attachment) => (
          <li
            key={attachment.id}
            className="flex items-start gap-2.5 rounded-lg border p-3"
          >
            <FileText
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={attachment.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm break-all hover:underline"
                >
                  {attachment.fileName}
                </a>
                <Badge
                  variant={
                    attachment.parseStatus === "PARSED"
                      ? "secondary"
                      : attachment.parseStatus === "PENDING"
                        ? "ghost"
                        : "outline"
                  }
                >
                  {STATUS_LABEL[attachment.parseStatus] ??
                    attachment.parseStatus}
                </Badge>
                {attachment.extractedText ? (
                  <span className="text-muted-foreground text-xs">
                    {attachment.extractedText.length.toLocaleString()}자
                  </span>
                ) : null}
              </div>
              {attachment.parseError ? (
                <p className="text-muted-foreground text-xs leading-5">
                  {attachment.parseError}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {message ? (
        <p className="rounded-lg border border-dashed p-3 text-sm">{message}</p>
      ) : null}
    </section>
  );
}

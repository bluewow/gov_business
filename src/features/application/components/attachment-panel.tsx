"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { extractApplicationAttachments, setAttachmentUsage } from "../actions";
import type { ApplicationDetail } from "../api/application-queries";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "미추출",
  PARSED: "추출 완료",
  UNSUPPORTED: "미지원 형식",
  FAILED: "실패",
};

/**
 * 공고 첨부파일 본문 추출 · AI 입력 선택.
 *
 * 전체 공고를 일괄 처리하면 수백 MB 를 정부 서버에서 받아야 해서,
 * 실제로 지원할 공고에 한해 사용자가 버튼을 눌렀을 때만 받는다.
 *
 * 추출한 것을 전부 AI 에 넘기지는 않는다. 공고문·신청서 양식·체크리스트가 함께 붙고
 * 같은 문서가 hwpx·pdf 로 두 벌 오는 일이 흔해서, 다 넣으면 프롬프트 상한에 걸려
 * 정작 필요한 자격요건이 잘려 나간다. 그래서 항목별로 켜고 끌 수 있게 했다.
 */
export function AttachmentPanel({
  application,
}: {
  application: ApplicationDetail;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const attachments = application.announcement.attachments;
  const parsed = attachments.filter((item) => item.parseStatus === "PARSED");
  const selected = parsed.filter((item) => item.useForAi);
  const totalChars = selected.reduce(
    (sum, item) => sum + (item.extractedText?.length ?? 0),
    0,
  );

  function extract(ids?: string[]) {
    setMessage(null);
    setPendingId(ids?.length === 1 ? ids[0]! : null);
    startTransition(async () => {
      const result = await extractApplicationAttachments(application.id, ids);
      setMessage(
        result.ok
          ? `첨부 ${result.total}건 중 ${result.parsed}건에서 본문을 추출했습니다. 아래에서 AI 에 넘길 것을 고른 뒤 요건 검토를 실행하세요.`
          : (result.error ?? "추출에 실패했습니다."),
      );
      setPendingId(null);
      router.refresh();
    });
  }

  function toggle(attachmentId: string, useForAi: boolean) {
    setPendingId(attachmentId);
    startTransition(async () => {
      await setAttachmentUsage(application.id, attachmentId, useForAi);
      setPendingId(null);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">공고 첨부파일</h2>
          <p className="text-muted-foreground text-xs leading-5">
            자격요건이 첨부 공고문에만 적힌 경우가 많습니다. 본문을 추출하고
            체크한 파일만 아래 AI 요건 검토·초안 작성의 근거로 넘어갑니다.
          </p>
        </div>
        <Button size="sm" disabled={isPending} onClick={() => extract()}>
          {isPending && !pendingId
            ? "추출 중…"
            : parsed.length > 0
              ? "전체 다시 추출"
              : attachments.length > 0
                ? `첨부 ${attachments.length}건 본문 추출`
                : "원문에서 공고문 찾기"}
        </Button>
      </div>

      {attachments.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm leading-6">
          이 공고에는 첨부파일이 등록돼 있지 않습니다.
          {application.announcement.sourceUrl
            ? " 다만 연결된 원문(기업마당)에 공고문이 있을 수 있어, 버튼을 누르면 그쪽에서 찾아옵니다."
            : " AI 검토는 공고 본문만 근거로 판단합니다."}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {attachments.map((attachment) => {
          const isParsed = attachment.parseStatus === "PARSED";
          const busy = isPending && pendingId === attachment.id;

          return (
            <li
              key={attachment.id}
              className="flex items-start gap-2.5 rounded-lg border p-3"
            >
              {isParsed ? (
                <input
                  type="checkbox"
                  checked={attachment.useForAi}
                  disabled={isPending}
                  onChange={(event) =>
                    toggle(attachment.id, event.target.checked)
                  }
                  aria-label={`${attachment.fileName} 를 AI 검토에 사용`}
                  className="accent-primary mt-0.5 size-4 shrink-0"
                />
              ) : (
                <FileText
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  aria-hidden
                />
              )}

              <div className="flex min-w-0 flex-1 flex-col gap-1">
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
                      isParsed
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
                  {isParsed && !attachment.useForAi ? (
                    <span className="text-muted-foreground text-xs">
                      · AI 입력에서 제외됨
                    </span>
                  ) : null}
                </div>
                {attachment.parseError ? (
                  <p className="text-muted-foreground text-xs leading-5">
                    {attachment.parseError}
                  </p>
                ) : null}
              </div>

              {!isParsed ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => extract([attachment.id])}
                >
                  {busy ? "추출 중…" : "이것만 추출"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {parsed.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          AI 에 넘길 본문: {selected.length}/{parsed.length}건 ·{" "}
          {totalChars.toLocaleString()}자
          {selected.length === 0
            ? " — 하나도 선택하지 않아 공고 본문만으로 검토합니다."
            : ""}
        </p>
      ) : null}

      {message ? (
        <p className="rounded-lg border border-dashed p-3 text-sm">{message}</p>
      ) : null}
    </section>
  );
}

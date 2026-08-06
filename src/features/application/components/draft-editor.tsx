"use client";

import { useRouter } from "next/navigation";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRuntimeKeys } from "@/stores/api-keys-store";
import { Textarea } from "@/components/ui/textarea";

import { generateAllDrafts, generateDraft, saveDraft } from "../actions";
import { checkAiReadiness } from "../ai-readiness";
import type { ApplicationDetail } from "../api/application-queries";
import { DRAFT_SECTIONS } from "../sections";

interface SectionState {
  content: string;
  generatedAt: Date | null;
  dirty: boolean;
}

function initialState(
  application: ApplicationDetail,
): Record<string, SectionState> {
  const state: Record<string, SectionState> = {};
  for (const section of DRAFT_SECTIONS) {
    const draft = application.drafts.find(
      (item) => item.sectionKey === section.key,
    );
    state[section.key] = {
      content: draft?.content ?? "",
      generatedAt: draft?.generatedAt ?? null,
      dirty: false,
    };
  }
  return state;
}

export function DraftEditor({
  application,
}: {
  application: ApplicationDetail;
}) {
  const router = useRouter();
  const keys = useRuntimeKeys();
  const [sections, setSections] = useState(() => initialState(application));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(key: string, patch: Partial<SectionState>) {
    setSections((previous) => ({
      ...previous,
      [key]: { ...previous[key]!, ...patch },
    }));
  }

  function handleGenerate(sectionKey: string) {
    setError(null);
    setBusyKey(sectionKey);
    startTransition(async () => {
      const result = await generateDraft(application.id, sectionKey, keys);
      setBusyKey(null);
      if (!result.ok) {
        setError(result.error ?? "초안 생성에 실패했습니다.");
        return;
      }
      update(sectionKey, {
        content: result.content ?? "",
        generatedAt: new Date(),
        dirty: false,
      });
      router.refresh();
    });
  }

  function handleGenerateAll() {
    setError(null);
    setBusyKey("ALL");
    startTransition(async () => {
      const result = await generateAllDrafts(application.id, keys);
      setBusyKey(null);
      if (!result.ok) {
        setError(
          `${result.error ?? "초안 생성에 실패했습니다."} (${result.generated}개 완료)`,
        );
      }
      router.refresh();
    });
  }

  function handleSave(sectionKey: string) {
    setError(null);
    setBusyKey(sectionKey);
    startTransition(async () => {
      const result = await saveDraft(
        application.id,
        sectionKey,
        sections[sectionKey]?.content ?? "",
      );
      setBusyKey(null);
      if (!result.ok) {
        setError(result.error ?? "저장에 실패했습니다.");
        return;
      }
      update(sectionKey, { dirty: false });
      router.refresh();
    });
  }

  const filledCount = DRAFT_SECTIONS.filter(
    (section) => (sections[section.key]?.content ?? "").trim().length > 0,
  ).length;

  const readiness = checkAiReadiness(application.announcement.attachments);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">사업계획서 초안</h2>
          <p className="text-muted-foreground text-xs">
            PSST 표준 목차 · {filledCount}/{DRAFT_SECTIONS.length} 섹션 작성됨.
            AI 초안은 출발점이고, 수치는 직접 채워야 합니다.
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleGenerateAll}
          disabled={isPending || !readiness.ready}
        >
          {busyKey === "ALL" ? "전체 생성 중…" : "전체 초안 생성"}
        </Button>
      </div>

      {readiness.notice ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs leading-5">
          {readiness.notice}
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive border-destructive/30 bg-destructive/5 rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      {DRAFT_SECTIONS.map((section) => {
        const state = sections[section.key]!;
        return (
          <section
            key={section.key}
            className="flex flex-col gap-2 rounded-lg border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">{section.title}</h3>
                {state.generatedAt ? (
                  <Badge variant="ghost">AI 초안</Badge>
                ) : null}
                {state.dirty ? (
                  <Badge variant="outline">저장 안 됨</Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isPending || !readiness.ready}
                  onClick={() => handleGenerate(section.key)}
                >
                  {busyKey === section.key ? "생성 중…" : "AI 초안"}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={isPending || !state.dirty}
                  onClick={() => handleSave(section.key)}
                >
                  저장
                </Button>
              </div>
            </div>

            <p className="text-muted-foreground text-xs leading-5">
              {section.guide}
            </p>

            <Textarea
              rows={10}
              value={state.content}
              onChange={(event) =>
                update(section.key, {
                  content: event.target.value,
                  dirty: true,
                })
              }
              placeholder="AI 초안을 생성하거나 직접 작성하세요."
            />
          </section>
        );
      })}
    </div>
  );
}

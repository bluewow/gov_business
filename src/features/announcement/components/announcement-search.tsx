"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type {
  AnnouncementSort,
  AnnouncementStatus,
} from "../api/announcement-queries";

/**
 * 제목 검색.
 *
 * 상태·정렬과 같은 자리(쿼리스트링)에 검색어를 넣어 새로고침·공유해도 그대로 열린다.
 * 필터는 링크로 충분하지만 검색은 입력이 필요해 이 컴포넌트만 클라이언트다.
 */
export function AnnouncementSearch({
  query,
  status,
  sort,
}: {
  query: string;
  status: AnnouncementStatus;
  sort: AnnouncementSort;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [isPending, startTransition] = useTransition();

  function search(next: string) {
    const params = new URLSearchParams({ status, sort });
    const trimmed = next.trim();
    if (trimmed) params.set("q", trimmed);

    startTransition(() => router.push(`/announcements?${params}`));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        search(value);
      }}
      className="flex items-center gap-1.5"
      role="search"
    >
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="제목 검색 (예: 창업 교육)"
        aria-label="공고 제목 검색"
        className="h-7 w-52 text-sm"
      />
      <Button type="submit" size="xs" variant="outline" disabled={isPending}>
        {isPending ? "검색 중…" : "검색"}
      </Button>
      {query ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setValue("");
            search("");
          }}
        >
          지우기
        </Button>
      ) : null}
    </form>
  );
}

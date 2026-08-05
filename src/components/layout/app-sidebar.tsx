"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";
import { useApiKeysStore } from "@/stores/api-keys-store";

import { NAV_GROUPS } from "./nav-items";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 서버 .env 에 키가 있는지 (값은 받지 않는다) */
export interface ServerKeyStatus {
  dataGoKr: boolean;
  openai: boolean;
}

function NavContent({
  onNavigate,
  serverKeys,
}: {
  onNavigate?: () => void;
  serverKeys: ServerKeyStatus;
}) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const browserOpenai = useApiKeysStore((state) => state.openai);
  const browserDataGoKr = useApiKeysStore((state) => state.dataGoKr);

  // 어느 쪽에도 키가 없으면 「API 키」 항목에 표시를 띄워 어디서 넣는지 알린다
  const missingKey =
    hydrated &&
    (!(serverKeys.openai || browserOpenai.trim()) ||
      !(serverKeys.dataGoKr || browserDataGoKr.trim()));

  return (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="text-muted-foreground px-3 pb-1 text-xs font-medium">
            {group.step !== null ? (
              <span className="text-foreground/70 mr-1.5">{group.step}</span>
            ) : null}
            {group.title}
          </p>

          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    {item.label}
                    {item.href === "/settings/api-keys" && missingKey ? (
                      <span
                        title="입력되지 않은 키가 있습니다"
                        aria-label="입력되지 않은 키가 있습니다"
                        className="bg-destructive size-1.5 rounded-full"
                      />
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {item.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AppSidebar({ serverKeys }: { serverKeys: ServerKeyStatus }) {
  // 드로어는 링크 클릭(onNavigate)과 오버레이 클릭에서 닫는다.
  // pathname 변화를 effect 로 감시해 닫으면 불필요한 연쇄 렌더가 생긴다.
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 데스크톱: 고정 사이드바 */}
      <aside className="bg-card hidden w-64 shrink-0 flex-col border-r lg:flex">
        <Link
          href="/"
          className="flex h-14 items-center gap-2 border-b px-5 text-sm font-semibold"
        >
          정부지원사업 큐레이터
        </Link>
        <NavContent serverKeys={serverKeys} />
      </aside>

      {/* 모바일: 상단 바 + 드로어 */}
      <div className="bg-card fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="메뉴 열기"
          aria-expanded={open}
          className="hover:bg-muted rounded-md p-1.5"
        >
          <Menu className="size-5" />
        </button>
        <Link href="/" className="text-sm font-semibold">
          정부지원사업 큐레이터
        </Link>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
            className="bg-foreground/40 absolute inset-0"
          />
          <div className="bg-card absolute inset-y-0 left-0 flex w-72 flex-col shadow-xl">
            <div className="flex h-14 items-center justify-between border-b px-5">
              <span className="text-sm font-semibold">메뉴</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="메뉴 닫기"
                className="hover:bg-muted rounded-md p-1.5"
              >
                <X className="size-4" />
              </button>
            </div>
            <NavContent
              onNavigate={() => setOpen(false)}
              serverKeys={serverKeys}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

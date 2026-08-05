import type { ReactNode } from "react";

/** 모든 페이지가 같은 여백/최대너비를 쓰도록 하는 래퍼 */
export function PageShell({
  step,
  title,
  description,
  actions,
  children,
}: {
  /** 사이드바의 단계 번호와 맞춘다. 개요 화면은 생략. */
  step?: number;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-3 border-b pb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            {step !== undefined ? (
              <span className="text-muted-foreground text-xs font-medium">
                STEP {step}
              </span>
            ) : null}
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          </div>
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </div>
        {description ? (
          <div className="text-muted-foreground text-sm leading-6">
            {description}
          </div>
        ) : null}
      </header>

      {children}
    </main>
  );
}

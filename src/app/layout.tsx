import type { Metadata } from "next";
import localFont from "next/font/local";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { QueryProvider } from "@/providers/query-provider";

import "./globals.css";

const pretendard = localFont({
  src: "../../public/fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  weight: "45 920",
});

export const metadata: Metadata = {
  title: {
    default: "정부지원사업 큐레이터",
    template: "%s | 정부지원사업 큐레이터",
  },
  description:
    "지원사업 공고를 수집해 내 사업과의 연관도를 분석하고, 지원서 작성까지 돕는 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${pretendard.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full">
        <QueryProvider>
          <AppSidebar />
          {/* 모바일 상단 바(h-14) 만큼 여백을 준다 */}
          <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
            {children}
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}

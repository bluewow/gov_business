import { LinkButton } from "@/components/common/link-button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="text-muted-foreground text-7xl font-bold tracking-tighter">
        404
      </p>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">페이지를 찾을 수 없습니다</h1>
        <p className="text-muted-foreground text-sm">
          주소가 변경되었거나 삭제된 페이지입니다.
        </p>
      </div>
      <LinkButton href="/">홈으로 돌아가기</LinkButton>
    </main>
  );
}

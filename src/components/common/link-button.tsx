import Link from "next/link";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

/**
 * 링크로 동작하는 버튼.
 *
 * Base UI 의 Button 은 기본값이 `nativeButton: true` 라서 `render` 로 `<a>` 를 넘기면
 * "네이티브 button 을 기대했다"는 콘솔 경고가 뜬다. 넘길 때마다 `nativeButton={false}` 를
 * 같이 적는 대신 여기서 한 번에 묶는다.
 * (components/ui/ 는 shadcn 이 덮어쓰므로 직접 고치지 않고 wrapper 로 감싼다)
 */
export function LinkButton({
  href,
  children,
  ...props
}: Omit<ButtonProps, "render" | "nativeButton"> & {
  href: ComponentProps<typeof Link>["href"];
}) {
  return (
    <Button {...props} nativeButton={false} render={<Link href={href} />}>
      {children}
    </Button>
  );
}

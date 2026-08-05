import { Badge } from "@/components/ui/badge";

/**
 * 공고 제목. seed 로 넣은 샘플 공고는 원문 링크가 사이트 루트뿐이라 링크를 걸지 않는다.
 * 실제 수집 공고와 화면에서 확실히 구분되도록 SampleBadge 와 함께 쓴다.
 */
export function AnnouncementTitle({
  title,
  url,
  isSample,
}: {
  title: string;
  url: string;
  isSample: boolean;
}) {
  if (isSample) {
    return <span className="text-muted-foreground">{title}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {title}
    </a>
  );
}

/** 실제 공고가 아니라는 표시 */
export function SampleBadge() {
  return (
    <Badge variant="outline" title="개발용 샘플 데이터 — 실제 공고가 아닙니다">
      샘플
    </Badge>
  );
}

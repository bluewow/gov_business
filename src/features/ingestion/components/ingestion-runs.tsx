import { Badge } from "@/components/ui/badge";

import type { IngestionRunItem } from "../api/ingestion-queries";

export function IngestionRuns({ runs }: { runs: IngestionRunItem[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        아직 수집을 실행한 적이 없습니다.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-muted-foreground border-b text-xs">
          <tr>
            <th className="px-2 py-2 text-left font-medium">시각</th>
            <th className="px-2 py-2 text-left font-medium">소스</th>
            <th className="px-2 py-2 text-left font-medium">상태</th>
            <th className="px-2 py-2 text-right font-medium">수집</th>
            <th className="px-2 py-2 text-right font-medium">신규</th>
            <th className="px-2 py-2 text-right font-medium">갱신</th>
            <th className="px-2 py-2 text-right font-medium">임베딩</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b last:border-0">
              <td className="text-muted-foreground px-2 py-2 whitespace-nowrap">
                {run.startedAt.toISOString().slice(0, 16).replace("T", " ")}
              </td>
              <td className="px-2 py-2">{run.source}</td>
              <td className="px-2 py-2">
                {run.status === "SUCCESS" ? (
                  <Badge variant="secondary">성공</Badge>
                ) : run.status === "FAILED" ? (
                  <Badge variant="destructive">실패</Badge>
                ) : (
                  <Badge variant="outline">진행중</Badge>
                )}
              </td>
              <td className="px-2 py-2 text-right">{run.fetchedCount}</td>
              <td className="px-2 py-2 text-right">{run.createdCount}</td>
              <td className="px-2 py-2 text-right">{run.updatedCount}</td>
              <td className="px-2 py-2 text-right">{run.embeddedCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

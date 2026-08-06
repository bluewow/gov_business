import { getAiUsageSummary, type AiFeature } from "@/lib/ai-usage";
import { formatDate } from "@/lib/format";

const FEATURE_LABEL: Record<AiFeature, string> = {
  EMBEDDING: "임베딩 (공고·프로필)",
  EVALUATION: "큐레이션 LLM 평가",
  REVIEW: "AI 요건 검토",
  STRATEGY: "합격 전략",
  DRAFT: "사업계획서 초안",
};

const number = (value: number) => value.toLocaleString();

/**
 * 기능별 토큰 사용량.
 *
 * OpenAI 응답의 `usage` 를 그대로 쌓은 값이라 추정이 아니라 실측이다.
 * 기록을 켜기 전에 나간 호출은 잡히지 않으므로 누적값은 "켠 시점 이후" 기준이다.
 */
export async function AiUsagePanel() {
  const { rows, total, lastUsedAt } = await getAiUsageSummary();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold">AI 토큰 사용량</h2>
        <p className="text-muted-foreground text-xs">
          호출마다 응답의 usage 를 기록한 실측값입니다. 기능별로 어디서 많이
          나가는지 볼 수 있습니다.
        </p>
      </div>

      {!total ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          아직 기록된 호출이 없습니다. AI 검토·초안·큐레이션 평가를 한 번
          실행하면 여기에 쌓입니다.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th className="px-2 py-2 text-left font-medium">기능</th>
                <th className="px-2 py-2 text-right font-medium">호출</th>
                <th className="px-2 py-2 text-right font-medium">입력</th>
                <th className="px-2 py-2 text-right font-medium">출력</th>
                <th className="px-2 py-2 text-right font-medium">합계</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.feature} className="border-b">
                  <td className="px-2 py-2">{FEATURE_LABEL[row.feature]}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {number(row.calls)}
                    {row.items > row.calls ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({number(row.items)}건)
                      </span>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-2 py-2 text-right tabular-nums">
                    {number(row.promptTokens)}
                  </td>
                  <td className="text-muted-foreground px-2 py-2 text-right tabular-nums">
                    {number(row.completionTokens)}
                  </td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">
                    {number(row.totalTokens)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-2 py-2 font-medium">전체</td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">
                  {number(total.calls)}
                </td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">
                  {number(total.promptTokens)}
                </td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">
                  {number(total.completionTokens)}
                </td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">
                  {number(total.totalTokens)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {lastUsedAt ? (
        <p className="text-muted-foreground text-xs">
          마지막 호출 {formatDate(lastUsedAt)}
        </p>
      ) : null}
    </section>
  );
}

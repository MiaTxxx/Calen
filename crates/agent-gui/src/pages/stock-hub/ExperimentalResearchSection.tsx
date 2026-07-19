import type { ResearchBundle } from "../../lib/stock-research";
import { BulletSection, StatusBadge } from "./shared";

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function evidenceItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(evidenceRecord).filter((item) => Object.keys(item).length)
    : [];
}

function evidenceValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("zh-CN");
  return null;
}

type EvidenceRow = { title: string; detail: string };

// 实验层结果（指标/评分/策略/Evaluator）形状随算法版本变化，按结构化条目展开。
function quantAnalysisRows(data: unknown): EvidenceRow[] {
  const root = evidenceRecord(data);
  const collection = evidenceItems(
    root.factors ?? root.dimensions ?? root.signals ?? root.registry ?? root.items,
  );
  if (collection.length) {
    return collection.slice(0, 12).map((item, index) => {
      const title =
        evidenceValue(item.name ?? item.id ?? item.strategyId ?? item.label) ??
        `第 ${index + 1} 项`;
      const detail = Object.entries(item)
        .flatMap(([key, value]) => {
          const rendered = evidenceValue(value);
          return rendered && key !== "name" && key !== "id" ? [`${key}: ${rendered}`] : [];
        })
        .join(" · ");
      return { title, detail: detail || "已返回结构化实验结果" };
    });
  }
  return Object.entries(root).flatMap(([key, value]) => {
    const direct = evidenceValue(value);
    if (direct) return [{ title: key, detail: direct }];
    const nested = evidenceRecord(value);
    const detail = Object.entries(nested)
      .flatMap(([nestedKey, nestedValue]) => {
        const rendered = evidenceValue(nestedValue);
        return rendered ? [`${nestedKey}: ${rendered}`] : [];
      })
      .join(" · ");
    return detail ? [{ title: key, detail }] : [];
  });
}

export function ExperimentalResearchSection({ data }: { data: ResearchBundle }) {
  const metadata = data.analysisMetadata;
  const capabilityLabels = {
    technical: "技术指标",
    score: "评分卡",
    strategy: "策略信号",
    evaluator: "Evaluator",
  } as const;
  return (
    <section className="mt-5 rounded-2xl border border-violet-500/20 bg-violet-500/[0.035] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">实验性量化分析</h3>
            <StatusBadge status="partial" label="实验性" />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            与事实数据分区展示，仅用于可复算的研究实验，不构成交易指令。
          </p>
        </div>
      </div>

      {metadata ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ResearchMetadataItem
              label="算法与版本"
              value={`${metadata.algorithm.id} @ ${metadata.algorithm.version}`}
            />
            <ResearchMetadataItem
              label="样本区间"
              value={`${metadata.sample.start ?? "未提供"} — ${metadata.sample.end ?? "未提供"} · ${metadata.sample.bars} 根`}
            />
            <ResearchMetadataItem
              label="样本覆盖率"
              value={`${(metadata.sample.coverage * 100).toFixed(1)}%`}
            />
            <ResearchMetadataItem
              label="基准"
              value={`${metadata.benchmark.name}${
                metadata.benchmark.returnPercent === null
                  ? " · 收益未提供"
                  : ` · ${metadata.benchmark.returnPercent.toFixed(2)}%`
              }`}
            />
          </div>
          <details className="mt-3 rounded-xl border border-violet-500/15 bg-background/45 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium">算法参数</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground">
              {JSON.stringify(metadata.algorithm.parameters, null, 2)}
            </pre>
          </details>
        </>
      ) : null}

      {data.experimentalAnalysis.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {data.experimentalAnalysis.map((analysis) => (
            <div
              key={analysis.capability}
              className="rounded-xl border border-violet-500/15 bg-background/55 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  {capabilityLabels[analysis.capability]}
                </span>
                <StatusBadge status={analysis.status} />
              </div>
              <p className="mt-2 break-words text-[11px] leading-5 text-muted-foreground">
                {analysis.summary ?? "当前样本未返回可展示结果。"}
              </p>
              {quantAnalysisRows(analysis.data).length ? (
                <div className="mt-2 space-y-1.5">
                  {quantAnalysisRows(analysis.data).map((row) => (
                    <div
                      key={`${analysis.capability}-${row.title}`}
                      className="rounded-lg bg-muted/30 px-2 py-1.5"
                    >
                      <div className="text-[11px] font-medium">{row.title}</div>
                      <div className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
                        {row.detail}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {analysis.warnings.length ? (
                <p className="mt-2 text-[10.5px] leading-4 text-amber-700 dark:text-amber-300">
                  {analysis.warnings.join("；")}
                </p>
              ) : null}
              <details className="mt-2 rounded-lg border border-violet-500/15 px-2 py-1.5">
                <summary className="cursor-pointer text-[10.5px] text-muted-foreground">
                  原始实验数据
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-muted-foreground">
                  {JSON.stringify(analysis.data, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      ) : null}

      {metadata?.limitations.length ? (
        <BulletSection title="限制说明" items={metadata.limitations} warning />
      ) : null}
    </section>
  );
}

function ResearchMetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-violet-500/15 bg-background/55 p-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-xs font-medium">{value}</div>
    </div>
  );
}

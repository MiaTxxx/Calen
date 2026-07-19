import { type FormEvent, useState } from "react";
import { GlassPanel } from "../../components/hub/HubChrome";
import { Loader2, Sparkles } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/shared/utils";
import {
  type AsyncResource,
  type BacktestResult,
  formatStockError,
  parseFiniteNumber,
  type ResearchBundle,
  type StockBacktestStrategyId,
  type StockEvidenceResult,
  stockResearch,
} from "../../lib/stock-research";
import { ExperimentalResearchSection } from "./ExperimentalResearchSection";
import { StockChart } from "./StockChart";
import {
  BulletSection,
  Disclaimer,
  EvidenceHeader,
  Field,
  LoadingCard,
  Metric,
  ResourceError,
  StatusBadge,
  UnavailableCard,
} from "./shared";

export function LabView() {
  const [symbol, setSymbol] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [period, setPeriod] = useState("20");
  const [evaluationRatio, setEvaluationRatio] = useState("0.3");
  const [strategy, setStrategy] = useState<StockBacktestStrategyId>("fused");
  const [result, setResult] = useState<AsyncResource<StockEvidenceResult<BacktestResult>>>({
    state: "idle",
  });
  const [analysis, setAnalysis] = useState<AsyncResource<StockEvidenceResult<ResearchBundle>>>({
    state: "idle",
  });

  async function resolveLabInstrument() {
    const matches = await stockResearch.resolve({
      query: symbol.trim(),
      limit: 1,
    });
    const instrument = matches.instruments[0];
    if (!instrument) throw new Error("Lab instrument was not found");
    return instrument;
  }

  async function runAnalysis() {
    if (!symbol.trim()) return;
    setAnalysis({ state: "loading" });
    try {
      const instrument = await resolveLabInstrument();
      const selectedStrategy =
        strategy === "fused" || strategy === "sma-cross" ? undefined : [strategy];
      setAnalysis({
        state: "ready",
        data: await stockResearch.research({
          instrument,
          capabilities: ["history", "technical", "score", "strategy", "evaluator"],
          ...(selectedStrategy ? { strategyIds: selectedStrategy } : {}),
        }),
      });
    } catch (error) {
      setAnalysis({ state: "error", message: formatStockError(error) });
    }
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    const parsedPeriod = parseFiniteNumber(period);
    const parsedEvaluationRatio = parseFiniteNumber(evaluationRatio);
    if (
      !symbol.trim() ||
      !from ||
      !to ||
      parsedEvaluationRatio === null ||
      parsedEvaluationRatio < 0.1 ||
      parsedEvaluationRatio > 0.8 ||
      (strategy === "sma-cross" && parsedPeriod === null)
    )
      return;
    setResult({ state: "loading" });
    try {
      const instrument = await resolveLabInstrument();
      setResult({
        state: "ready",
        data: await stockResearch.backtest({
          instrument,
          strategy,
          from,
          to,
          parameters: strategy === "sma-cross" ? { period: parsedPeriod } : {},
          evaluationRatio: parsedEvaluationRatio,
        }),
      });
    } catch (error) {
      setResult({ state: "error", message: formatStockError(error) });
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <GlassPanel className="h-fit">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <h2 className="text-sm font-semibold">策略回测</h2>
          <StatusBadge status="partial" label="实验性" />
        </div>
        <form onSubmit={run} className="mt-4 space-y-3">
          <Field label="标的">
            <Input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="例如 600519"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="开始日期">
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field label="结束日期">
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
          <Field label="策略模型">
            <select
              value={strategy}
              onChange={(event) => setStrategy(event.target.value as StockBacktestStrategyId)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="fused">多策略融合</option>
              <option value="trend">趋势跟踪</option>
              <option value="mean-reversion">均值回归</option>
              <option value="breakout">区间突破</option>
              <option value="momentum">动量交叉</option>
              <option value="volume-price">量价确认</option>
              <option value="sma-cross">SMA 交叉</option>
            </select>
          </Field>
          <Field label="均线周期">
            <Input
              inputMode="numeric"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              disabled={strategy !== "sma-cross"}
            />
          </Field>
          <Field label="样本外评估比例">
            <Input
              type="number"
              min={0.1}
              max={0.8}
              step={0.05}
              inputMode="decimal"
              value={evaluationRatio}
              onChange={(event) => setEvaluationRatio(event.target.value)}
              placeholder="0.3"
            />
          </Field>
          <Button type="submit" className="w-full" disabled={result.state === "loading"}>
            {result.state === "loading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            运行回测
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => void runAnalysis()}
            disabled={analysis.state === "loading"}
          >
            {analysis.state === "loading" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            运行指标、评分与 Evaluator
          </Button>
        </form>
        <Disclaimer />
      </GlassPanel>
      <div>
        {result.state === "idle" ? (
          <GlassPanel className="flex min-h-[350px] items-center justify-center text-center text-xs text-muted-foreground">
            回测结果会显示算法版本、样本覆盖、基准与限制。
          </GlassPanel>
        ) : null}
        {result.state === "loading" ? (
          <LoadingCard text="按时间切分加载历史数据并执行回测…" />
        ) : null}
        <ResourceError resource={result} panel />
        {result.state === "ready" && result.data.data ? (
          <BacktestCard result={result.data} />
        ) : null}
        {result.state === "ready" && !result.data.data ? (
          <UnavailableCard result={result.data} />
        ) : null}
        {analysis.state === "loading" ? (
          <LoadingCard text="正在计算技术指标、评分卡、策略信号和 Evaluator…" />
        ) : null}
        <ResourceError resource={analysis} panel />
        {analysis.state === "ready" && analysis.data.data ? (
          <ExperimentalResearchSection data={analysis.data.data} />
        ) : null}
        {analysis.state === "ready" && !analysis.data.data ? (
          <UnavailableCard result={analysis.data} />
        ) : null}
      </div>
    </div>
  );
}

function BacktestCard({ result }: { result: StockEvidenceResult<BacktestResult> }) {
  const data = result.data;
  if (!data) return null;
  return (
    <GlassPanel>
      <EvidenceHeader result={result} title="回测结果" />
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric
          label="策略收益"
          value={data.returnPercent === null ? "—" : `${data.returnPercent}%`}
        />
        <Metric
          label="基准收益"
          value={data.benchmarkReturnPercent === null ? "—" : `${data.benchmarkReturnPercent}%`}
        />
        <Metric
          label="最大回撤"
          value={data.maxDrawdownPercent === null ? "—" : `${data.maxDrawdownPercent}%`}
        />
        <Metric
          label="数据覆盖"
          value={`${Math.round(data.coverage * 100)}%${result.status === "partial" ? "（部分）" : ""}`}
        />
      </div>
      <StockChart
        points={data.equityCurve.map((point) => ({ time: point.time, value: point.equity }))}
        positive={(data.returnPercent ?? 0) >= 0}
        className="mt-4"
        label="回测权益曲线"
      />
      <div className="mt-3 rounded-xl border border-border/35 bg-background/45 p-3 text-[11px] text-muted-foreground">
        <div className="font-medium text-foreground/80">
          {data.algorithmId} v{data.algorithmVersion} · 基准 {data.benchmark || "未知"}
        </div>
        <div className="mt-1">
          全部样本：{data.sample.from || "未知"} 至 {data.sample.to || "未知"} ·{" "}
          {data.sample.points} 根 · 覆盖率 {Math.round(data.sample.coverage * 100)}%
        </div>
        <div className="mt-1">
          校准区间：{data.sample.calibration.from || "未知"} 至{" "}
          {data.sample.calibration.to || "未知"} · {data.sample.calibration.points} 根 · 覆盖率{" "}
          {Math.round(data.sample.calibration.coverage * 100)}%
        </div>
        <div className="mt-1">
          样本外评估：{data.sample.evaluation.from || "未知"} 至{" "}
          {data.sample.evaluation.to || "未知"} · {data.sample.evaluation.points} 根 · 覆盖率{" "}
          {Math.round(data.sample.evaluation.coverage * 100)}%
        </div>
      </div>
      <BacktestParameters parameters={data.parameters} />
      <BacktestTrades trades={data.trades} />
      {data.limitations.length ? (
        <BulletSection title="限制说明" items={data.limitations} warning />
      ) : null}
      <Disclaimer />
    </GlassPanel>
  );
}

function BacktestParameters({ parameters }: { parameters: Record<string, unknown> }) {
  const entries = Object.entries(parameters);
  if (!entries.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-border/35 bg-background/45 p-3">
      <div className="text-xs font-semibold">算法参数与费用假设</div>
      <div className="mt-2 grid gap-1.5 text-[11px] text-muted-foreground sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3">
            <span>{key}</span>
            <span className="text-right font-mono text-foreground/80">
              {formatBacktestParameter(key, value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBacktestParameter(key: string, value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (key === "feeRate" || key === "evaluationRatio") {
      return `${(value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}%`;
    }
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "—");
}

function BacktestTrades({ trades }: { trades: BacktestResult["trades"] }) {
  return (
    <div className="mt-3 rounded-xl border border-border/35 bg-background/45 p-3">
      <div className="text-xs font-semibold">逐笔交易（信号 / 执行 / 费用）</div>
      {trades.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[11px] text-muted-foreground">
            <thead>
              <tr className="border-b border-border/35 text-[10.5px]">
                <th className="px-2 py-1.5 font-medium">方向</th>
                <th className="px-2 py-1.5 font-medium">信号时间</th>
                <th className="px-2 py-1.5 font-medium">执行时间</th>
                <th className="px-2 py-1.5 text-right font-medium">价格</th>
                <th className="px-2 py-1.5 text-right font-medium">数量</th>
                <th className="px-2 py-1.5 text-right font-medium">费用</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr
                  key={`${trade.signalTime}-${trade.executionTime}-${trade.side}`}
                  className="border-b border-border/20 last:border-0"
                >
                  <td
                    className={cn(
                      "px-2 py-1.5 font-medium",
                      trade.side === "buy" ? "text-red-600" : "text-emerald-600",
                    )}
                  >
                    {trade.side === "buy" ? "买入" : "卖出"}
                  </td>
                  <td className="px-2 py-1.5 font-mono">{trade.signalTime}</td>
                  <td className="px-2 py-1.5 font-mono">{trade.executionTime}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{trade.price}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{trade.quantity}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{trade.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-muted-foreground">评估区间内没有可记录的交易。</div>
      )}
    </div>
  );
}

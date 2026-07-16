export type StockResultMetricFormat = "number" | "percent" | "coverage" | "integer";

export type StockResultMetric = {
  id: string;
  label: string;
  value: number;
  format: StockResultMetricFormat;
  signed?: boolean;
  tone?: "up" | "down" | "neutral";
};

export type StockResultTrend = {
  label: string;
  values: number[];
  tone: "up" | "down" | "neutral";
};

export type StockResultCardModel = {
  metrics: StockResultMetric[];
  trend?: StockResultTrend;
};

type StockResultCardInput = {
  operation: string;
  status?: "ok" | "partial" | "unavailable";
  result: unknown;
};

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metric(
  id: string,
  label: string,
  value: unknown,
  format: StockResultMetricFormat,
  options: Pick<StockResultMetric, "signed" | "tone"> = {},
): StockResultMetric | undefined {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : { id, label, value: parsed, format, ...options };
}

function toneFromSignedValue(value: unknown): StockResultMetric["tone"] {
  const parsed = finiteNumber(value);
  if (parsed === undefined || parsed === 0) return "neutral";
  return parsed > 0 ? "up" : "down";
}

function evidencePayload(result: unknown) {
  const root = asRecord(result);
  const evidence = asRecord(root.evidence);
  return Object.keys(evidence).length > 0 ? evidence : root;
}

function quotePayload(result: unknown) {
  const evidence = evidencePayload(result);
  const data = asRecord(evidence.data);
  if (finiteNumber(data.price) !== undefined) return data;
  const snapshot = asRecord(data.snapshot);
  if (finiteNumber(snapshot.price) !== undefined) return snapshot;
  const factsSnapshot = asRecord(asRecord(data.facts).snapshot);
  return finiteNumber(factsSnapshot.price) !== undefined ? factsSnapshot : data;
}

function extractSeries(value: unknown, objectKeys: readonly string[], limit = 120): number[] {
  if (!Array.isArray(value)) return [];
  const values = value.flatMap((entry) => {
    const direct = finiteNumber(entry);
    if (direct !== undefined) return [direct];
    const record = asRecord(entry);
    for (const key of objectKeys) {
      const candidate = finiteNumber(record[key]);
      if (candidate !== undefined) return [candidate];
    }
    return [];
  });
  return values.length >= 2 ? values.slice(-limit) : [];
}

function quoteTrend(quote: Record<string, unknown>): StockResultTrend | undefined {
  const chart = quote.chart;
  const bars = Array.isArray(chart) ? chart : asRecord(chart).bars;
  const values = extractSeries(bars, ["close"]);
  if (values.length < 2) return undefined;
  return {
    label: "价格走势",
    values,
    tone: toneFromSignedValue(quote.changePercent ?? quote.change) ?? "neutral",
  };
}

function buildQuoteModel(result: unknown): StockResultCardModel {
  const quote = quotePayload(result);
  const movementTone = toneFromSignedValue(quote.changePercent ?? quote.change);
  const metrics = [
    metric("price", "现价", quote.price, "number"),
    metric("changePercent", "涨跌幅", quote.changePercent, "percent", {
      signed: true,
      tone: movementTone,
    }),
    metric("change", "涨跌", quote.change, "number", {
      signed: true,
      tone: movementTone,
    }),
    metric("open", "开盘", quote.open, "number"),
    metric("high", "最高", quote.high, "number"),
    metric("low", "最低", quote.low, "number"),
    metric("previousClose", "昨收", quote.previousClose, "number"),
    metric("volume", "成交量", quote.volume, "integer"),
  ].filter((item): item is StockResultMetric => item !== undefined);
  const trend = quoteTrend(quote);
  return {
    metrics: metrics.slice(0, 6),
    ...(trend ? { trend } : {}),
  };
}

function buildBacktestModel(result: unknown): StockResultCardModel {
  const evidence = evidencePayload(result);
  const data = asRecord(evidence.data);
  const payload = Object.keys(asRecord(data.metrics)).length > 0 ? data : evidence;
  const metricsRecord = asRecord(payload.metrics);
  const benchmark = asRecord(payload.benchmark);
  const sample = asRecord(payload.sample);
  const returnTone = toneFromSignedValue(metricsRecord.returnPercent);
  const benchmarkTone = toneFromSignedValue(benchmark.returnPercent);
  const trades = Array.isArray(payload.trades) ? payload.trades : undefined;
  const metrics = [
    metric("returnPercent", "策略收益", metricsRecord.returnPercent, "percent", {
      signed: true,
      tone: returnTone,
    }),
    metric("benchmarkReturnPercent", "基准收益", benchmark.returnPercent, "percent", {
      signed: true,
      tone: benchmarkTone,
    }),
    metric("maxDrawdownPercent", "最大回撤", metricsRecord.maxDrawdownPercent, "percent"),
    metric("finalEquity", "期末权益", metricsRecord.finalEquity, "number"),
    metric("sampleBars", "样本数", sample.bars, "integer"),
    metric("coverage", "数据覆盖率", sample.coverage, "coverage"),
    metric("tradeCount", "交易次数", trades?.length, "integer"),
  ].filter((item): item is StockResultMetric => item !== undefined);
  const values = extractSeries(payload.equityCurve, ["equity", "value", "portfolioValue"]);
  const trend =
    values.length >= 2
      ? ({ label: "权益曲线", values, tone: returnTone ?? "neutral" } satisfies StockResultTrend)
      : undefined;
  return {
    metrics,
    ...(trend ? { trend } : {}),
  };
}

export function buildStockResultCardModel(input: StockResultCardInput): StockResultCardModel {
  if (input.status === "unavailable") return { metrics: [] };
  if (input.operation === "backtest") return buildBacktestModel(input.result);
  if (input.operation === "snapshot" || input.operation === "research") {
    return buildQuoteModel(input.result);
  }
  return { metrics: [] };
}

export function formatStockResultMetric(metric: StockResultMetric): string {
  const value = metric.format === "coverage" ? metric.value * 100 : metric.value;
  if (metric.format === "integer") return Math.trunc(value).toLocaleString("zh-CN");
  const formatted =
    metric.format === "number"
      ? numberFormatter.format(value)
      : `${value.toLocaleString("zh-CN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}%`;
  return metric.signed && value > 0 ? `+${formatted}` : formatted;
}

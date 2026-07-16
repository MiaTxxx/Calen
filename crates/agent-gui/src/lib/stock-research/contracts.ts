import type {
  BacktestResult,
  EvidenceSource,
  InstrumentRef,
  InstrumentSearchResult,
  MarketBrief,
  MarketBriefRequest,
  MarketBriefSection,
  QuoteSnapshot,
  ResearchAnalysisMetadata,
  ResearchBundle,
  ResearchEvidenceSection,
  ResearchExperimentalAnalysis,
  ResearchExperimentalCapability,
  StockBacktestRequest,
  StockCapability,
  StockEvidenceResult,
  StockFinancialsData,
  StockFxRatesResult,
  StockMarket,
  StockResearchRequest,
  StockServiceStatus,
  StockSnapshotRequest,
} from "./types";

export type AsyncResource<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; message: string };

export function isStockResultStatus(value: unknown): value is "ok" | "partial" | "unavailable" {
  return value === "ok" || value === "partial" || value === "unavailable";
}

export function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function formatStockError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "股票服务暂时不可用，请稍后重试。";
}

export function sanitizeCsvFileName(value: string): string {
  const normalized = Array.from(value.trim(), (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || '<>:"/\\|?*'.includes(character) ? "-" : character;
  }).join("");
  return normalized || "calen-portfolio.csv";
}

export function parseFiniteNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildSparklinePath(
  values: readonly number[],
  width: number,
  height: number,
): string {
  if (values.length === 0 || width <= 0 || height <= 0) return "";
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length !== values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xStep = values.length === 1 ? 0 : width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * xStep;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function strictRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isStockCurrency(value: unknown): value is "CNY" | "HKD" | "USD" {
  return value === "CNY" || value === "HKD" || value === "USD";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function evidenceRecord(raw: unknown): AnyRecord {
  const record = asRecord(raw);
  return asRecord(record.evidence ?? record);
}

function normalizeEvidenceStatus(
  value: unknown,
  hasData: boolean,
): "ok" | "partial" | "unavailable" {
  if (value === "ok" || value === "complete") return "ok";
  if (value === "partial") return "partial";
  if (value === "unavailable") return "unavailable";
  return hasData ? "partial" : "unavailable";
}

function mapInstrument(value: unknown): InstrumentRef | null {
  const item = asRecord(value);
  const id = asString(item.id ?? item.canonicalId);
  const symbol = asString(item.symbol);
  const name = asString(item.name ?? item.displayName);
  const market =
    item.market === "CN" || item.market === "HK" || item.market === "US" ? item.market : "UNKNOWN";
  if (!id || !symbol || !name) return null;
  return {
    id,
    symbol,
    name,
    market,
    exchange: asString(item.exchange) ?? "",
    assetType:
      item.assetType === "stock" || item.assetType === "EQUITY"
        ? "stock"
        : item.assetType === "etf" || item.assetType === "ETF"
          ? "etf"
          : item.assetType === "index" || item.assetType === "INDEX"
            ? "index"
            : item.assetType === "fund"
              ? "fund"
              : "unknown",
    currency: asString(item.currency) ?? "",
  };
}

function mapSource(value: unknown): EvidenceSource | null {
  const item = asRecord(value);
  const provider = asString(item.provider);
  const id = asString(item.id) ?? provider;
  const name = asString(item.name ?? item.label) ?? provider;
  if (!id || !name) return null;
  const asOf = asString(item.asOf);
  return {
    id,
    name,
    ...(provider ? { provider } : {}),
    ...(asString(item.url) ? { url: asString(item.url) } : {}),
    ...(asString(item.capability) ? { capability: asString(item.capability) } : {}),
    ...(asOf ? { asOf } : {}),
    ...(asString(item.retrievedAt) ? { retrievedAt: asString(item.retrievedAt) } : {}),
    ...(typeof item.cached === "boolean" ? { cached: item.cached } : {}),
  };
}

function mapSources(value: unknown): EvidenceSource[] {
  return Array.isArray(value)
    ? value.map(mapSource).filter((item): item is EvidenceSource => item !== null)
    : [];
}

/**
 * A research envelope can combine quote, filing and notice providers.  The
 * sidecar's aggregate `asOf` is not guaranteed to be the oldest item in that
 * set, so the UI-facing envelope deliberately reports the earliest known
 * evidence timestamp.  Keep the original value as a fallback when providers
 * omit per-source timestamps or return a non-ISO label.
 */
function earliestEvidenceAsOf(sources: EvidenceSource[], fallback: string | null): string | null {
  const values = [
    ...sources.map((source) => source.asOf).filter((value): value is string => Boolean(value)),
    ...(fallback ? [fallback] : []),
  ];
  if (values.includes("unknown")) return "unknown";
  if (!values.length) return null;
  const parseable = values.flatMap((value) => {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? [] : [{ value, timestamp }];
  });
  if (parseable.length) {
    return parseable.reduce((oldest, current) =>
      current.timestamp < oldest.timestamp ? current : oldest,
    ).value;
  }
  return values[0] ?? null;
}

function mapEnvelope<T>(
  raw: unknown,
  data: T | null,
  extraWarnings: string[] = [],
): StockEvidenceResult<T> {
  const record = evidenceRecord(raw);
  const warnings = [...normalizeWarnings(record.warnings), ...extraWarnings];
  const sources = mapSources(record.sources);
  const aggregateAsOf = asString(record.asOf) ?? null;
  return {
    status: normalizeEvidenceStatus(record.status, data !== null),
    data,
    sources,
    asOf: earliestEvidenceAsOf(sources, aggregateAsOf),
    retrievedAt: asString(record.retrievedAt) ?? "",
    cached: record.cached === true,
    warnings,
  };
}

export function mapStockResolveEnvelope(raw: unknown): InstrumentSearchResult {
  const record = evidenceRecord(raw);
  const values = Array.isArray(record.instruments)
    ? record.instruments
    : Array.isArray(raw)
      ? raw
      : [];
  const instruments = values
    .map(mapInstrument)
    .filter((item): item is InstrumentRef => item !== null);
  const evidence = mapEnvelope(raw, instruments);
  return {
    status: evidence.status,
    instruments,
    sources: evidence.sources,
    asOf: evidence.asOf,
    retrievedAt: evidence.retrievedAt,
    cached: evidence.cached,
    warnings: evidence.warnings,
  };
}

export function mapStockFxRatesResult(raw: unknown): StockFxRatesResult {
  const record = evidenceRecord(raw);
  const rates = Array.isArray(record.rates)
    ? record.rates.flatMap((value) => {
        const item = asRecord(value);
        const fromCurrency = asString(item.fromCurrency);
        const toCurrency = asString(item.toCurrency);
        const rate = asNumber(item.rate);
        const asOf = asString(item.asOf);
        return isStockCurrency(fromCurrency) &&
          isStockCurrency(toCurrency) &&
          fromCurrency !== toCurrency &&
          rate !== null &&
          rate > 0 &&
          asOf
          ? [{ fromCurrency, toCurrency, rate, asOf }]
          : [];
      })
    : [];
  const evidence = mapEnvelope(raw, rates.length ? rates : null);
  return {
    status: evidence.status,
    rates,
    sources: evidence.sources,
    asOf: evidence.asOf,
    retrievedAt: evidence.retrievedAt,
    cached: evidence.cached,
    warnings: evidence.warnings,
  };
}

function mapChart(value: unknown): NonNullable<QuoteSnapshot["chart"]> {
  const record = asRecord(value);
  const values = Array.isArray(record.bars) ? record.bars : Array.isArray(value) ? value : [];
  return values.flatMap((entry) => {
    const item = asRecord(entry);
    const time = asString(item.time);
    const close = asNumber(item.close);
    const open = asNumber(item.open);
    const high = asNumber(item.high);
    const low = asNumber(item.low);
    if (!time || close === null) return [];
    return [
      {
        time,
        close,
        ...(open === null ? {} : { open }),
        ...(high === null ? {} : { high }),
        ...(low === null ? {} : { low }),
      },
    ];
  });
}

const FACT_RESEARCH_CAPABILITIES = new Set([
  "profile",
  "financials",
  "shareholders",
  "dividend",
  "moneyFlow",
  "news",
  "notices",
  "etf",
]);

const EXPERIMENTAL_RESEARCH_CAPABILITIES: readonly ResearchExperimentalCapability[] = [
  "technical",
  "score",
  "strategy",
  "evaluator",
];

function summarizeResearchData(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `items=${value.length}`;
  const parts: string[] = [];
  const pending: Array<{ path: string; value: unknown; depth: number }> = Object.entries(
    asRecord(value),
  ).map(([path, item]) => ({
    path,
    value: item,
    depth: 0,
  }));
  while (pending.length && parts.length < 5) {
    const current = pending.shift();
    if (!current) break;
    const item = current.value;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      parts.push(`${current.path}=${String(item)}`);
    } else if (Array.isArray(item)) {
      parts.push(`${current.path}[${item.length}]`);
    } else if (item && typeof item === "object" && current.depth < 2) {
      for (const [key, nested] of Object.entries(asRecord(item))) {
        pending.push({
          path: `${current.path}.${key}`,
          value: nested,
          depth: current.depth + 1,
        });
      }
    }
  }
  if (!parts.length) return null;
  const summary = parts.join(", ");
  return summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;
}

function mapFinancialStatement(value: unknown): Record<string, number | undefined> | null {
  const source = strictRecord(value);
  if (!source) return null;
  const statement: Record<string, number | undefined> = {};
  for (const [key, item] of Object.entries(source)) {
    const number = asNumber(item);
    if (number !== null) statement[key] = number;
  }
  return statement;
}

function mapFinancialsEvidence(value: unknown): StockFinancialsData | null {
  const source = strictRecord(value);
  const statements = strictRecord(source?.statements);
  const coverage = strictRecord(source?.coverage);
  const reportDate = asString(source?.reportDate);
  const currency = asString(source?.currency);
  const requestedPeriods = asNumber(coverage?.requestedPeriods);
  const returnedPeriods = asNumber(coverage?.returnedPeriods);
  const completePeriods = asNumber(coverage?.completePeriods);
  if (
    !source ||
    !statements ||
    !coverage ||
    !reportDate ||
    !currency ||
    requestedPeriods === null ||
    returnedPeriods === null ||
    completePeriods === null
  ) {
    return null;
  }
  const periods = Array.isArray(source.periods)
    ? source.periods.slice(0, 4).flatMap((entry) => {
        const period = strictRecord(entry);
        const periodDate = asString(period?.reportDate);
        if (!period || !periodDate) return [];
        return [
          {
            reportDate: periodDate,
            income: mapFinancialStatement(period.income),
            balance: mapFinancialStatement(period.balance),
            cashFlow: mapFinancialStatement(period.cashFlow),
          },
        ];
      })
    : [];
  if (!periods.length || periods.length > 4) return null;
  return {
    reportDate,
    currency,
    statements: {
      income: mapFinancialStatement(statements.income),
      balance: mapFinancialStatement(statements.balance),
      cashFlow: mapFinancialStatement(statements.cashFlow),
    },
    periods,
    coverage: {
      requestedPeriods,
      returnedPeriods,
      completePeriods,
      ...(asString(coverage.oldestReportDate)
        ? { oldestReportDate: asString(coverage.oldestReportDate) }
        : {}),
      ...(asString(coverage.newestReportDate)
        ? { newestReportDate: asString(coverage.newestReportDate) }
        : {}),
    },
    missingStatements: asStringArray(source.missingStatements),
  };
}

function mapResearchAnalysisMetadata(value: unknown): ResearchAnalysisMetadata | undefined {
  const metadata = strictRecord(value);
  const algorithm = strictRecord(metadata?.algorithm);
  const parameters = strictRecord(algorithm?.parameters);
  const sample = strictRecord(metadata?.sample);
  const benchmark = strictRecord(metadata?.benchmark);
  if (!metadata || !algorithm || !parameters || !sample || !benchmark) return undefined;

  const algorithmId = asString(algorithm.id);
  const algorithmVersion = asString(algorithm.version);
  const hasSampleStart = Object.hasOwn(sample, "start");
  const hasSampleEnd = Object.hasOwn(sample, "end");
  const sampleStart = sample.start === null ? null : asString(sample.start);
  const sampleEnd = sample.end === null ? null : asString(sample.end);
  const sampleBars = asNumber(sample.bars);
  const sampleCoverage = asNumber(sample.coverage);
  const benchmarkName = asString(benchmark.name);
  const hasBenchmarkReturn = Object.hasOwn(benchmark, "returnPercent");
  const benchmarkReturn =
    benchmark.returnPercent === null ? null : asNumber(benchmark.returnPercent);
  const limitations = Array.isArray(metadata.limitations)
    ? metadata.limitations.every((item) => typeof item === "string" && item.trim().length > 0)
      ? metadata.limitations.map((item) => String(item).trim())
      : undefined
    : undefined;

  if (
    !algorithmId ||
    !algorithmVersion ||
    !hasSampleStart ||
    sampleStart === undefined ||
    !hasSampleEnd ||
    sampleEnd === undefined ||
    sampleBars === null ||
    !Number.isInteger(sampleBars) ||
    sampleBars < 0 ||
    sampleCoverage === null ||
    sampleCoverage < 0 ||
    sampleCoverage > 1 ||
    !benchmarkName ||
    !hasBenchmarkReturn ||
    benchmarkReturn === undefined ||
    !limitations
  ) {
    return undefined;
  }

  return {
    algorithm: {
      id: algorithmId,
      version: algorithmVersion,
      parameters,
    },
    sample: {
      start: sampleStart,
      end: sampleEnd,
      bars: sampleBars,
      coverage: sampleCoverage,
    },
    benchmark: {
      name: benchmarkName,
      returnPercent: benchmarkReturn,
    },
    limitations,
  };
}

function mapExperimentalAnalysis(capabilities: AnyRecord): ResearchExperimentalAnalysis[] {
  return EXPERIMENTAL_RESEARCH_CAPABILITIES.flatMap((capability) => {
    const section = strictRecord(capabilities[capability]);
    if (!section || !isStockResultStatus(section.status)) return [];
    return [
      {
        capability,
        status: section.status,
        summary:
          section.data === null || section.data === undefined
            ? null
            : summarizeResearchData(section.data),
        data: section.data ?? null,
        warnings: normalizeWarnings(section.warnings),
      },
    ];
  });
}

function mapResearchEvidenceSections(capabilities: AnyRecord): ResearchEvidenceSection[] {
  return [...FACT_RESEARCH_CAPABILITIES].flatMap((capability) => {
    const section = strictRecord(capabilities[capability]);
    if (!section || !isStockResultStatus(section.status)) return [];
    return [
      {
        capability: capability as ResearchEvidenceSection["capability"],
        status: section.status,
        data:
          capability === "financials"
            ? (mapFinancialsEvidence(section.data) ?? section.data ?? null)
            : (section.data ?? null),
        warnings: normalizeWarnings(section.warnings),
      },
    ];
  });
}

export function mapStockSnapshotResult(raw: unknown): StockEvidenceResult<QuoteSnapshot> {
  const envelope = evidenceRecord(raw);
  const dataRecord = asRecord(envelope.data);
  const instrument = mapInstrument(dataRecord.instrument ?? envelope.instrument);
  if (!instrument) return mapEnvelope<QuoteSnapshot>(raw, null, ["snapshot 缺少有效 instrument"]);
  const chart = mapChart(dataRecord.chart ?? dataRecord.history);
  const facts = Array.isArray(dataRecord.facts)
    ? dataRecord.facts.flatMap((entry) => {
        const item = asRecord(entry);
        const label = asString(item.label);
        const value = asString(item.value);
        return label && value ? [{ label, value, hint: asString(item.hint) }] : [];
      })
    : undefined;
  const data: QuoteSnapshot = {
    instrument,
    price: asNumber(dataRecord.price),
    change: asNumber(dataRecord.change),
    changePercent: asNumber(dataRecord.changePercent),
    open: asNumber(dataRecord.open),
    high: asNumber(dataRecord.high),
    low: asNumber(dataRecord.low),
    previousClose: asNumber(dataRecord.previousClose),
    volume: asNumber(dataRecord.volume),
    ...(chart.length ? { chart } : {}),
    ...(facts?.length ? { facts } : {}),
  };
  return mapEnvelope(raw, data);
}

function mapResearchBundle(raw: unknown): ResearchBundle | null {
  const envelope = evidenceRecord(raw);
  const data = asRecord(envelope.data);
  const factsRecord = asRecord(data.facts);
  const snapshotRaw = factsRecord.snapshot ?? data.snapshot;
  const snapshotResult = snapshotRaw
    ? mapStockSnapshotResult({ ...envelope, data: snapshotRaw })
    : null;
  const instrument = mapInstrument(
    envelope.instrument ?? data.instrument ?? asRecord(snapshotRaw).instrument,
  );
  if (!instrument) return null;
  const title = asString(data.title) ?? instrument.name;
  const summary = asString(data.summary) ?? "";
  const facts = asStringArray(data.facts);
  if (typeof factsRecord.historyBars === "number" && Number.isFinite(factsRecord.historyBars)) {
    facts.push(`historyBars: ${factsRecord.historyBars}`);
  }
  const positiveCases = asStringArray(data.positiveCases ?? data.positives);
  const risks = asStringArray(data.risks);
  const openQuestions = asStringArray(data.openQuestions);
  for (const warning of normalizeWarnings(envelope.warnings)) {
    const experimentalWarning = EXPERIMENTAL_RESEARCH_CAPABILITIES.some((capability) =>
      warning.startsWith(`${capability}:`),
    );
    if (!experimentalWarning && !openQuestions.includes(warning)) openQuestions.push(warning);
  }
  const capabilities = asRecord(data.capabilities);
  for (const [capability, rawSection] of Object.entries(capabilities)) {
    if (!FACT_RESEARCH_CAPABILITIES.has(capability)) continue;
    const section = asRecord(rawSection);
    const status = section.status;
    const sectionWarnings = normalizeWarnings(section.warnings);
    if (status === "ok" && section.data !== null && section.data !== undefined) {
      const summaryText = summarizeResearchData(section.data);
      if (summaryText) facts.push(`${capability}: ${summaryText}`);
    } else if (status === "partial" || status === "unavailable") {
      risks.push(`${capability}: ${status}`);
    }
    openQuestions.push(...sectionWarnings.map((warning) => `${capability}: ${warning}`));
  }
  const experimentalAnalysis = mapExperimentalAnalysis(capabilities);
  const evidenceSections = mapResearchEvidenceSections(capabilities);
  const analysisMetadata = mapResearchAnalysisMetadata(data.analysisMetadata);
  return {
    instrument,
    title,
    summary,
    facts,
    positiveCases,
    risks,
    openQuestions,
    evidenceSections,
    experimentalAnalysis,
    ...(analysisMetadata ? { analysisMetadata } : {}),
    ...(snapshotResult?.data ? { snapshot: snapshotResult.data } : {}),
  };
}

export function mapStockResearchResult(raw: unknown): StockEvidenceResult<ResearchBundle> {
  const data = mapResearchBundle(raw);
  return mapEnvelope(raw, data, data ? [] : ["research 缺少可展示的 instrument"]);
}

const marketSectionLabels: Record<MarketBriefSection, string> = {
  movers: "涨跌幅榜",
  limitUp: "涨停与连板",
  limitDown: "跌停",
  hotSectors: "热门板块",
  moneyFlow: "板块资金流",
  dragonTiger: "龙虎榜",
  unusualMoves: "盘中异动",
  sentiment: "市场情绪",
};

function marketDisplayValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value))
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
  if (typeof value === "boolean") return value ? "是" : "否";
  return null;
}

function marketFields(item: AnyRecord) {
  return Object.entries(item).flatMap(([key, value]) => {
    const direct = marketDisplayValue(value);
    if (direct) return [{ label: key, value: direct }];
    const nested = strictRecord(value);
    if (!nested) return [];
    return Object.entries(nested).flatMap(([nestedKey, nestedValue]) => {
      const rendered = marketDisplayValue(nestedValue);
      return rendered ? [{ label: `${key}.${nestedKey}`, value: rendered }] : [];
    });
  });
}

function mapMarketSection(
  key: MarketBriefSection,
  value: unknown,
): MarketBrief["sections"][number] | null {
  if (value === null || value === undefined) return null;
  const root = asRecord(value);
  const values = Array.isArray(value) ? value : Array.isArray(root.items) ? root.items : [value];
  const items = values.flatMap((entry, index) => {
    const item = strictRecord(entry);
    if (!item) return [];
    const title =
      asString(
        item.name ??
          item.securityName ??
          item.title ??
          item.symbol ??
          item.code ??
          item.label ??
          item.method,
      ) ?? `${marketSectionLabels[key]} ${index + 1}`;
    const changePercent = asNumber(item.changePercent);
    const price = asNumber(item.price ?? item.closePrice);
    const score = asNumber(item.score);
    const primaryValue =
      score !== null
        ? `${score}/100`
        : changePercent !== null
          ? `${changePercent}%`
          : price !== null
            ? String(price)
            : marketDisplayValue(item.mainNetInflow ?? item.netBuyAmount ?? item.amount);
    const detail = asString(
      item.message ??
        item.reason ??
        item.explanation ??
        item.disclaimer ??
        item.industry ??
        item.time,
    );
    return [
      {
        title,
        ...(primaryValue ? { value: primaryValue } : {}),
        ...(detail ? { detail } : {}),
        fields: marketFields(item),
      },
    ];
  });
  if (!items.length) return null;
  const total = asNumber(root.total);
  return {
    key,
    label: marketSectionLabels[key],
    ...(total !== null ? { total } : {}),
    items,
  };
}

export function mapStockMarketBriefResult(
  raw: unknown,
  fallbackSession: MarketBrief["generatedFor"] = "on_demand",
): StockEvidenceResult<MarketBrief> {
  const envelope = evidenceRecord(raw);
  const data = asRecord(envelope.data);
  const market = asString(data.market);
  const session = asString(data.session);
  const tradeDate = asString(data.tradeDate);
  const requestedSections = Array.isArray(data.requestedSections)
    ? data.requestedSections.filter(
        (value): value is MarketBriefSection =>
          value === "movers" ||
          value === "limitUp" ||
          value === "limitDown" ||
          value === "hotSectors" ||
          value === "moneyFlow" ||
          value === "dragonTiger" ||
          value === "unusualMoves" ||
          value === "sentiment",
      )
    : [];
  const sections = asRecord(data.sections);
  const movers = Array.isArray(data.movers) ? data.movers : [];
  const detailedSections = [
    mapMarketSection("movers", movers),
    mapMarketSection("limitUp", sections.limitUp),
    mapMarketSection("limitDown", sections.limitDown),
    mapMarketSection("hotSectors", sections.hotSectors),
    mapMarketSection("moneyFlow", sections.moneyFlow),
    mapMarketSection("dragonTiger", sections.dragonTiger),
    mapMarketSection("unusualMoves", sections.unusualMoves),
    mapMarketSection("sentiment", sections.sentiment),
  ].filter((section): section is MarketBrief["sections"][number] => section !== null);
  const highlights = movers.flatMap((entry) => {
    const item = asRecord(entry);
    const title = asString(item.name ?? item.symbol);
    if (!title) return [];
    const changePercent = asNumber(item.changePercent);
    const price = asNumber(item.price);
    return [
      {
        title,
        value: price === null ? undefined : String(price),
        detail: changePercent === null ? "" : `${changePercent}%`,
        tone:
          changePercent === null
            ? ("neutral" as const)
            : changePercent >= 0
              ? ("up" as const)
              : ("down" as const),
      },
    ];
  });
  if (Array.isArray(data.highlights)) {
    for (const entry of data.highlights) {
      const item = asRecord(entry);
      const title = asString(item.title);
      if (!title) continue;
      highlights.push({
        title,
        value: asString(item.value),
        detail: asString(item.detail) ?? "",
        tone:
          item.tone === "up" || item.tone === "down" || item.tone === "neutral"
            ? item.tone
            : "neutral",
      });
    }
  }
  for (const [key, label] of [
    ["limitUp", "limitUp"],
    ["limitDown", "limitDown"],
    ["hotSectors", "hotSectors"],
    ["moneyFlow", "moneyFlow"],
    ["dragonTiger", "dragonTiger"],
    ["unusualMoves", "unusualMoves"],
    ["sentiment", "sentiment"],
  ] as const) {
    if (sections[key] !== undefined && sections[key] !== null)
      highlights.push({
        title: label,
        value: undefined,
        detail: summarizeResearchData(sections[key]) ?? "数据已返回",
        tone: "neutral",
      });
  }
  if (!market && !highlights.length)
    return mapEnvelope<MarketBrief>(raw, null, ["marketBrief 缺少可展示数据"]);
  return mapEnvelope(raw, {
    title: asString(data.title) ?? (market ? `${market} market brief` : "Market brief"),
    summary: asString(data.summary) ?? "",
    highlights,
    sections: detailedSections,
    generatedFor:
      session === "pre_market" ? "pre_open" : session === "close" ? "close" : fallbackSession,
    ...(tradeDate ? { tradeDate } : {}),
    ...(requestedSections.length ? { requestedSections } : {}),
  });
}

export function mapStockBacktestResult(raw: unknown): StockEvidenceResult<BacktestResult> {
  const envelope = evidenceRecord(raw);
  const data = asRecord(envelope.data ?? raw);
  const algorithm = asRecord(data.algorithm);
  const sample = asRecord(data.sample);
  const benchmark = asRecord(data.benchmark);
  const metrics = asRecord(data.metrics);
  const instrument = mapInstrument(data.instrument ?? envelope.instrument);
  const mapWindow = (value: unknown) => {
    const window = asRecord(value);
    return {
      from: asString(window.start) ?? "",
      to: asString(window.end) ?? "",
      points: asNumber(window.bars) ?? 0,
      coverage: asNumber(window.coverage) ?? 0,
    };
  };
  const calibration = mapWindow(sample.calibration);
  const evaluation = mapWindow(sample.evaluation);
  const result: BacktestResult = {
    ...(instrument ? { instrument } : {}),
    algorithmId: asString(algorithm.id) ?? "",
    algorithmVersion: asString(algorithm.version) ?? "",
    parameters: asRecord(algorithm.parameters),
    sample: {
      from: asString(sample.start) ?? "",
      to: asString(sample.end) ?? "",
      points: asNumber(sample.bars) ?? 0,
      coverage: asNumber(sample.coverage) ?? 0,
      calibration,
      evaluation,
    },
    benchmark: asString(benchmark.name) ?? "",
    returnPercent: asNumber(metrics.returnPercent),
    benchmarkReturnPercent: asNumber(benchmark.returnPercent),
    maxDrawdownPercent: asNumber(metrics.maxDrawdownPercent),
    trades: Array.isArray(data.trades)
      ? data.trades.flatMap((entry) => {
          const item = asRecord(entry);
          const side = item.side === "buy" || item.side === "sell" ? item.side : null;
          const signalTime = asString(item.signalTime);
          const executionTime = asString(item.executionTime);
          const price = asNumber(item.price);
          const quantity = asNumber(item.quantity);
          const fee = asNumber(item.fee);
          return side &&
            signalTime &&
            executionTime &&
            price !== null &&
            quantity !== null &&
            fee !== null
            ? [{ signalTime, executionTime, side, price, quantity, fee }]
            : [];
        })
      : [],
    coverage: asNumber(sample.coverage) ?? 0,
    limitations: asStringArray(data.limitations),
    equityCurve: Array.isArray(data.equityCurve)
      ? data.equityCurve.flatMap((entry) => {
          const item = asRecord(entry);
          const time = asString(item.time);
          const equity = asNumber(item.equity);
          return time && equity !== null ? [{ time, equity }] : [];
        })
      : [],
  };
  const mapped = mapEnvelope(raw, result);
  return mapped.status === "unavailable" ? { ...mapped, data: null } : mapped;
}

export function mapStockServiceStatus(raw: unknown): StockServiceStatus {
  const record = asRecord(raw);
  const state =
    record.state === "ready" ||
    record.state === "degraded" ||
    record.state === "stopped" ||
    record.state === "failed" ||
    record.state === "starting"
      ? record.state
      : record.state === "unavailable"
        ? "failed"
        : "failed";
  const providers = Array.isArray(record.providers)
    ? record.providers.flatMap((value) => {
        const item = asRecord(value);
        const id = asString(item.id);
        if (!id) return [];
        const capabilities = Array.isArray(item.capabilities)
          ? item.capabilities.flatMap((capability) => {
              const map: Record<string, StockCapability> = {
                snapshot: "quote",
                history: "history",
                dividend: "dividends",
                moneyFlow: "capital_flow",
                marketBrief: "market_topic",
              };
              return (
                map[String(capability)] ??
                (Object.hasOwn(
                  {
                    quote: 1,
                    history: 1,
                    profile: 1,
                    financials: 1,
                    shareholders: 1,
                    dividends: 1,
                    capital_flow: 1,
                    news: 1,
                    notices: 1,
                    etf: 1,
                    technical: 1,
                    score: 1,
                    strategy: 1,
                    evaluator: 1,
                    backtest: 1,
                    market_topic: 1,
                  },
                  String(capability),
                )
                  ? (String(capability) as StockCapability)
                  : null)
              );
            })
          : [];
        const providerState:
          | "unknown"
          | "ready"
          | "cooldown"
          | "disabled"
          | "failed"
          | "unconfigured" =
          item.state === "disabled"
            ? "disabled"
            : item.state === "unknown"
              ? "unknown"
              : item.available === true
                ? "ready"
                : item.cooldownUntil || item.circuitOpenUntil
                  ? "cooldown"
                  : item.lastError
                    ? "failed"
                    : "unconfigured";
        const providerWarnings = normalizeWarnings(item.warnings);
        return [
          {
            id,
            name: asString(item.name) ?? id,
            state: providerState,
            capabilities,
            ...(asString(item.lastSuccessAt)
              ? { lastSuccessAt: asString(item.lastSuccessAt) }
              : {}),
            ...(asString(item.lastError) || providerWarnings[0]
              ? { message: asString(item.lastError) ?? providerWarnings[0] }
              : {}),
          },
        ];
      })
    : [];
  return {
    state,
    version: asString(record.version),
    message: asString(record.message),
    providers,
  };
}

export function toSidecarResolveRequest(request: {
  query: string;
  markets?: StockMarket[];
  limit?: number;
}): Record<string, unknown> {
  const market = request.markets?.find(
    (value): value is Exclude<StockMarket, "UNKNOWN"> =>
      value === "CN" || value === "HK" || value === "US",
  );
  return {
    query: request.query,
    ...(request.markets?.length === 1 && market ? { market } : {}),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
  };
}

export function toSidecarSnapshotRequest(request: StockSnapshotRequest): Record<string, unknown> {
  return {
    instrument: request.instrument,
    ...(request.includeHistory
      ? { includeHistory: true, historyLimit: 120, includeProfile: true }
      : {}),
  };
}

export function toSidecarResearchRequest(request: StockResearchRequest): Record<string, unknown> {
  const capabilityMap: Partial<Record<StockCapability, string>> = {
    quote: "snapshot",
    dividends: "dividend",
    capital_flow: "moneyFlow",
  };
  const capabilities = request.capabilities
    ?.map((capability) => capabilityMap[capability] ?? capability)
    .filter((capability) => capability !== "market_topic");
  return {
    instrument: request.instrument,
    ...(capabilities?.length ? { capabilities } : {}),
    ...(request.strategyIds?.length ? { strategyIds: request.strategyIds } : {}),
  };
}

export function toSidecarMarketBriefRequest(request: MarketBriefRequest): Record<string, unknown> {
  const session =
    request.session === "pre_open" || request.session === "pre_market"
      ? "pre_market"
      : request.session === "intraday"
        ? "intraday"
        : request.session === "close"
          ? "close"
          : "general";
  return {
    market: request.market,
    session,
    ...(request.tradeDate ? { tradeDate: request.tradeDate } : {}),
    ...(request.sections?.length ? { sections: request.sections } : {}),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
  };
}

export function toSidecarBacktestRequest(request: StockBacktestRequest): Record<string, unknown> {
  const parameters = request.parameters ?? {};
  const period =
    typeof parameters.period === "number" && Number.isInteger(parameters.period)
      ? parameters.period
      : undefined;
  const shortWindow =
    typeof parameters.shortWindow === "number" && Number.isInteger(parameters.shortWindow)
      ? parameters.shortWindow
      : period === undefined
        ? undefined
        : Math.max(1, Math.floor(period / 4));
  const longWindow =
    typeof parameters.longWindow === "number" && Number.isInteger(parameters.longWindow)
      ? parameters.longWindow
      : period;
  const initialCash =
    typeof parameters.initialCash === "number" && Number.isFinite(parameters.initialCash)
      ? parameters.initialCash
      : undefined;
  const feeRate =
    typeof parameters.feeRate === "number" && Number.isFinite(parameters.feeRate)
      ? parameters.feeRate
      : undefined;
  const evaluationRatio =
    typeof request.evaluationRatio === "number" && Number.isFinite(request.evaluationRatio)
      ? request.evaluationRatio
      : typeof parameters.evaluationRatio === "number" &&
          Number.isFinite(parameters.evaluationRatio)
        ? parameters.evaluationRatio
        : undefined;
  const strategyId = request.strategy === "moving_average" ? "sma-cross" : request.strategy;
  const strategy = {
    id: strategyId,
    ...(strategyId !== "sma-cross" || shortWindow === undefined ? {} : { shortWindow }),
    ...(strategyId !== "sma-cross" || longWindow === undefined ? {} : { longWindow }),
  };
  return {
    instrument: request.instrument,
    start: request.from,
    end: request.to,
    strategy,
    ...(initialCash === undefined ? {} : { initialCash }),
    ...(feeRate === undefined ? {} : { feeRate }),
    ...(evaluationRatio === undefined ? {} : { evaluationRatio }),
  };
}

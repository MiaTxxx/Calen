import type { ResearchBundle, ResearchEvidenceSection } from "../../../lib/stock-research";

// 研究子页签的证据解析层：把 sidecar 返回的 unknown 数据窄化成可渲染结构。
// 解析失败一律返回空集合，由页签展示 partial/unavailable 状态，绝不猜测字段补数。

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asItems(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length) : [];
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sectionFor(
  bundle: ResearchBundle,
  capability: ResearchEvidenceSection["capability"],
): ResearchEvidenceSection | null {
  return bundle.evidenceSections.find((section) => section.capability === capability) ?? null;
}

export interface CompanyProfile {
  companyName: string | null;
  industry: string | null;
  description: string | null;
  businessScope: string | null;
  website: string | null;
  listingDate: string | null;
  registeredCapital: number | null;
  employees: number | null;
  province: string | null;
  address: string | null;
  chairman: string | null;
  legalRepresentative: string | null;
}

export function parseProfile(data: unknown): CompanyProfile | null {
  const root = asRecord(data);
  if (!Object.keys(root).length) return null;
  return {
    companyName: asText(root.companyName),
    industry: asText(root.industry),
    description: asText(root.description),
    businessScope: asText(root.businessScope),
    website: asText(root.website),
    listingDate: asText(root.listingDate),
    registeredCapital: asNumber(root.registeredCapital),
    employees: asNumber(root.employees),
    province: asText(root.province),
    address: asText(root.address),
    chairman: asText(root.chairman),
    legalRepresentative: asText(root.legalRepresentative),
  };
}

export interface FinancialPeriod {
  reportDate: string;
  income: Record<string, number | null>;
  balance: Record<string, number | null>;
  cashFlow: Record<string, number | null>;
}

export interface FinancialsEvidence {
  periods: FinancialPeriod[];
  coverage: {
    requestedPeriods: number | null;
    returnedPeriods: number | null;
    completePeriods: number | null;
  } | null;
  missingStatements: string[];
}

function statementNumbers(value: unknown): Record<string, number | null> {
  const root = asRecord(value);
  const out: Record<string, number | null> = {};
  for (const [key, entry] of Object.entries(root)) out[key] = asNumber(entry);
  return out;
}

export function parseFinancials(data: unknown): FinancialsEvidence | null {
  const root = asRecord(data);
  // 有界报告期：与 sidecar 契约一致，最多展示最近 4 期。
  const periods = asItems(root.periods)
    .slice(0, 4)
    .flatMap((period) => {
      const reportDate = asText(period.reportDate);
      if (!reportDate) return [];
      return [
        {
          reportDate,
          income: statementNumbers(period.income),
          balance: statementNumbers(period.balance),
          cashFlow: statementNumbers(period.cashFlow),
        },
      ];
    });
  if (!periods.length) return null;
  const coverage = asRecord(root.coverage);
  return {
    periods,
    coverage: Object.keys(coverage).length
      ? {
          requestedPeriods: asNumber(coverage.requestedPeriods),
          returnedPeriods: asNumber(coverage.returnedPeriods),
          completePeriods: asNumber(coverage.completePeriods),
        }
      : null,
    missingStatements: Array.isArray(root.missingStatements)
      ? root.missingStatements.flatMap((item) => asText(item) ?? [])
      : [],
  };
}

// 报告期 → 简短中文标签（2025-12-31 → 2025年报）。
export function reportPeriodLabel(reportDate: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(reportDate);
  if (!match) return reportDate;
  const [, year, month] = match;
  const suffix =
    month === "03" ? "一季报" : month === "06" ? "中报" : month === "09" ? "三季报" : "年报";
  return `${year}${suffix}`;
}

export interface TopHolder {
  rank: number | null;
  name: string;
  shares: number | null;
  ratioPercent: number | null;
  change: string | null;
  holderType: string | null;
  marketValue: number | null;
}

export interface ShareholdersEvidence {
  reportDate: string | null;
  topHolders: TopHolder[];
}

export function parseShareholders(data: unknown): ShareholdersEvidence | null {
  const root = asRecord(data);
  const topHolders = asItems(root.topHolders).flatMap((row) => {
    const name = asText(row.name);
    if (!name) return [];
    return [
      {
        rank: asNumber(row.rank),
        name,
        shares: asNumber(row.shares),
        ratioPercent: asNumber(row.ratioPercent),
        change: asText(row.change),
        holderType: asText(row.holderType),
        marketValue: asNumber(row.marketValue),
      },
    ];
  });
  if (!topHolders.length) return null;
  return { reportDate: asText(root.reportDate), topHolders };
}

export interface DividendRow {
  reportDate: string;
  exDividendDate: string | null;
  recordDate: string | null;
  cashDividendPer10Shares: number | null;
  bonusSharesPer10: number | null;
  capitalizationPer10: number | null;
  progress: string | null;
  planSummary: string | null;
}

export function parseDividends(data: unknown): DividendRow[] {
  const root = asRecord(data);
  return asItems(root.history).flatMap((row) => {
    const reportDate = asText(row.reportDate);
    if (!reportDate) return [];
    return [
      {
        reportDate,
        exDividendDate: asText(row.exDividendDate),
        recordDate: asText(row.recordDate),
        cashDividendPer10Shares: asNumber(row.cashDividendPer10Shares),
        bonusSharesPer10: asNumber(row.bonusSharesPer10),
        capitalizationPer10: asNumber(row.capitalizationPer10),
        progress: asText(row.progress),
        planSummary: asText(row.planSummary),
      },
    ];
  });
}

export interface MoneyFlowPoint {
  date: string;
  mainNetInflow: number | null;
  mainNetPercent: number | null;
  superLargeNetInflow: number | null;
  largeNetInflow: number | null;
  mediumNetInflow: number | null;
  smallNetInflow: number | null;
  close: number | null;
  changePercent: number | null;
}

export function parseMoneyFlow(data: unknown): MoneyFlowPoint[] {
  const root = asRecord(data);
  return asItems(root.series).flatMap((row) => {
    const date = asText(row.date);
    if (!date) return [];
    return [
      {
        date,
        mainNetInflow: asNumber(row.mainNetInflow),
        mainNetPercent: asNumber(row.mainNetPercent),
        superLargeNetInflow: asNumber(row.superLargeNetInflow),
        largeNetInflow: asNumber(row.largeNetInflow),
        mediumNetInflow: asNumber(row.mediumNetInflow),
        smallNetInflow: asNumber(row.smallNetInflow),
        close: asNumber(row.close),
        changePercent: asNumber(row.changePercent),
      },
    ];
  });
}

export interface NewsItem {
  id: string;
  title: string;
  url: string | null;
  pdfUrl: string | null;
  publishedAt: string | null;
  source: string | null;
  summary: string | null;
}

export function parseNewsItems(data: unknown): NewsItem[] {
  const root = asRecord(data);
  return asItems(root.items).flatMap((row, index) => {
    const title = asText(row.title);
    if (!title) return [];
    return [
      {
        id: asText(row.id) ?? asText(row.url) ?? `${index}`,
        title,
        url: asText(row.url),
        pdfUrl: asText(row.pdfUrl),
        publishedAt: asText(row.publishedAt) ?? asText(row.date),
        source: asText(row.source),
        summary: asText(row.summary) ?? asText(row.content),
      },
    ];
  });
}

export interface EtfHolding {
  name: string;
  code: string | null;
  ratioPercent: number | null;
}

export interface EtfEvidence {
  fields: Array<{ label: string; value: string }>;
  holdings: EtfHolding[];
}

// ETF 数据形状随 Provider 变化较大：标量字段原样列出，持仓尽力解析。
export function parseEtf(data: unknown): EtfEvidence | null {
  const root = asRecord(data);
  if (!Object.keys(root).length) return null;
  const fields: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(root)) {
    const rendered =
      asText(value) ??
      (asNumber(value) !== null ? (value as number).toLocaleString("zh-CN") : null);
    if (rendered) fields.push({ label: key, value: rendered });
  }
  const holdings = asItems(root.holdings ?? root.topHoldings).flatMap((row) => {
    const name = asText(row.name) ?? asText(row.securityName);
    if (!name) return [];
    return [
      {
        name,
        code: asText(row.code) ?? asText(row.symbol),
        ratioPercent: asNumber(row.ratioPercent) ?? asNumber(row.ratio),
      },
    ];
  });
  if (!fields.length && !holdings.length) return null;
  return { fields, holdings };
}

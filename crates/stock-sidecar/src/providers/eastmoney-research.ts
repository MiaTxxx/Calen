import { ProviderError } from "./registry.ts";
import { extractPdfPlainText } from "../pdf-text.ts";
import type {
  InstrumentRef,
  ProviderContext,
  ProviderEvidence,
} from "../types.ts";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : undefined;
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripHtml(value: unknown): string | undefined {
  const source = text(value);
  return source
    ?.replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyCode(instrument: InstrumentRef): string | null {
  if (instrument.market !== "CN" || instrument.exchange === "BSE") return null;
  return `${instrument.exchange === "SSE" ? "SH" : "SZ"}${instrument.symbol}`;
}

function securityCode(instrument: InstrumentRef): string | null {
  if (instrument.market !== "CN" || instrument.exchange === "BSE") return null;
  return `${instrument.symbol}.${instrument.exchange === "SSE" ? "SH" : "SZ"}`;
}

function securityId(instrument: InstrumentRef): string | null {
  if (instrument.market !== "CN" || instrument.exchange === "BSE") return null;
  return `${instrument.exchange === "SSE" ? "1" : "0"}.${instrument.symbol}`;
}

async function fetchJson(
  url: URL,
  context: ProviderContext,
  referer = "https://data.eastmoney.com/"
): Promise<UnknownRecord> {
  const init: RequestInit = {
    headers: { Accept: "application/json", Referer: referer },
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(url, init);
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  const data = record(await response.json());
  if (!data) throw new ProviderError("东方财富返回无效 JSON");
  return data;
}

async function fetchText(
  url: URL,
  context: ProviderContext,
  referer = "https://so.eastmoney.com/"
): Promise<string> {
  const init: RequestInit = {
    headers: {
      Accept: "text/plain,application/json,text/html",
      Referer: referer,
    },
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(url, init);
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  return response.text();
}

async function fetchPdf(
  url: URL,
  context: ProviderContext,
  referer: string
): Promise<Uint8Array> {
  const init: RequestInit = {
    headers: { Accept: "application/pdf", Referer: referer },
  };
  if (context.signal) init.signal = context.signal;
  const response = await context.fetch(url, init);
  if (!response.ok)
    throw new ProviderError(`HTTP ${response.status}`, {
      status: response.status,
    });
  const declaredSize = finite(response.headers.get("content-length"));
  if (declaredSize !== undefined && declaredSize > 25 * 1024 * 1024) {
    throw new ProviderError("公告 PDF 超过 25 MiB 解析上限");
  }
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > 25 * 1024 * 1024)
    throw new ProviderError("公告 PDF 超过 25 MiB 解析上限");
  const signature = new TextDecoder("ascii").decode(data.slice(0, 8));
  if (!signature.startsWith("%PDF-"))
    throw new ProviderError("公告附件不是有效 PDF");
  return data;
}

function firstRow(payload: UnknownRecord): UnknownRecord | undefined {
  const result = record(payload.result);
  const data = Array.isArray(result?.data) ? result.data : [];
  return record(data[0]);
}

export async function fetchEastmoneyProfile(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  const code = companyCode(instrument);
  if (!code)
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["东方财富公司资料仅支持沪深 A 股"],
    };
  const url = new URL(
    "https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax"
  );
  url.searchParams.set("code", code);
  const payload = await fetchJson(
    url,
    context,
    "https://emweb.securities.eastmoney.com/"
  );
  const row = record(Array.isArray(payload.jbzl) ? payload.jbzl[0] : undefined);
  if (!row) return { data: null, asOf: context.now().toISOString() };
  return {
    data: {
      symbol: text(row.SECURITY_CODE) ?? instrument.symbol,
      name: text(row.SECURITY_NAME_ABBR) ?? instrument.name,
      companyName: text(row.ORG_NAME),
      companyNameEn: text(row.ORG_NAME_EN),
      industry: text(row.EM2016) ?? text(row.INDUSTRYCSRC1),
      description: text(row.ORG_PROFILE),
      businessScope: text(row.BUSINESS_SCOPE),
      website: text(row.ORG_WEB),
      email: text(row.ORG_EMAIL),
      listingDate: text(row.LISTING_DATE),
      registeredCapital: finite(row.REG_CAPITAL),
      employees: finite(row.EMP_NUM),
      province: text(row.PROVINCE),
      address: text(row.ADDRESS) ?? text(row.REG_ADDRESS),
      chairman: text(row.CHAIRMAN),
      legalRepresentative: text(row.LEGAL_PERSON),
      sourceUrl: url.toString(),
    },
    asOf: context.now().toISOString(),
  };
}

async function fetchStatement(
  instrument: InstrumentRef,
  reportName: string,
  context: ProviderContext
): Promise<UnknownRecord | undefined> {
  const code = securityCode(instrument);
  if (!code) return undefined;
  const url = new URL(
    "https://datacenter.eastmoney.com/securities/api/data/v1/get"
  );
  url.searchParams.set("reportName", reportName);
  url.searchParams.set("columns", "ALL");
  url.searchParams.set("filter", `(SECUCODE=\"${code}\")`);
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", "5");
  url.searchParams.set("sortTypes", "-1");
  url.searchParams.set("sortColumns", "REPORT_DATE");
  url.searchParams.set("source", "HSF10");
  url.searchParams.set("client", "PC");
  return firstRow(
    await fetchJson(url, context, "https://emweb.securities.eastmoney.com/")
  );
}

async function fetchReportRows(
  instrument: InstrumentRef,
  reportName: string,
  filterColumn: "SECUCODE" | "SECURITY_CODE",
  sortColumn: string,
  context: ProviderContext,
  pageSize = 20
): Promise<UnknownRecord[]> {
  const filterValue =
    filterColumn === "SECUCODE" ? securityCode(instrument) : instrument.symbol;
  if (
    !filterValue ||
    instrument.market !== "CN" ||
    instrument.exchange === "BSE"
  )
    return [];
  const url = new URL(
    "https://datacenter.eastmoney.com/securities/api/data/v1/get"
  );
  url.searchParams.set("reportName", reportName);
  url.searchParams.set("columns", "ALL");
  url.searchParams.set("filter", `(${filterColumn}=\"${filterValue}\")`);
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("sortTypes", "-1");
  url.searchParams.set("sortColumns", sortColumn);
  url.searchParams.set("source", "HSF10");
  url.searchParams.set("client", "PC");
  const result = record(
    (await fetchJson(url, context, "https://emweb.securities.eastmoney.com/"))
      .result
  );
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows.map(record).filter((row) => row !== undefined);
}

export async function fetchEastmoneyFinancials(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  if (!securityCode(instrument))
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["东方财富财务三表仅支持沪深 A 股"],
    };
  const settled = await Promise.allSettled([
    fetchStatement(instrument, "RPT_DMSK_FN_INCOME", context),
    fetchStatement(instrument, "RPT_DMSK_FN_BALANCE", context),
    fetchStatement(instrument, "RPT_DMSK_FN_CASHFLOW", context),
  ]);
  const income =
    settled[0].status === "fulfilled" ? settled[0].value : undefined;
  const balance =
    settled[1].status === "fulfilled" ? settled[1].value : undefined;
  const cashFlow =
    settled[2].status === "fulfilled" ? settled[2].value : undefined;
  const requestFailures = [
    settled[0].status === "rejected" &&
      `利润表请求失败：${settled[0].reason instanceof Error ? settled[0].reason.message : String(settled[0].reason)}`,
    settled[1].status === "rejected" &&
      `资产负债表请求失败：${settled[1].reason instanceof Error ? settled[1].reason.message : String(settled[1].reason)}`,
    settled[2].status === "rejected" &&
      `现金流量表请求失败：${settled[2].reason instanceof Error ? settled[2].reason.message : String(settled[2].reason)}`,
  ].filter((warning): warning is string => Boolean(warning));
  const missing = [
    !income && "利润表",
    !balance && "资产负债表",
    !cashFlow && "现金流量表",
  ].filter(Boolean);
  const reportDate =
    text(income?.REPORT_DATE) ??
    text(balance?.REPORT_DATE) ??
    text(cashFlow?.REPORT_DATE) ??
    context.now().toISOString();
  const data = {
    reportDate,
    currency:
      text(income?.CURRENCY) ??
      text(balance?.CURRENCY) ??
      text(cashFlow?.CURRENCY) ??
      "CNY",
    statements: {
      income: income
        ? {
            totalOperatingRevenue:
              finite(income.TOTAL_OPERATE_INCOME) ??
              finite(income.TOTALOPERATEREVE),
            totalOperatingCost: finite(income.TOTAL_OPERATE_COST),
            operatingProfit: finite(income.OPERATE_PROFIT),
            totalProfit: finite(income.TOTAL_PROFIT),
            netProfit:
              finite(income.PARENT_NETPROFIT) ?? finite(income.NETPROFIT),
            deductedNetProfit: finite(income.DEDUCT_PARENT_NETPROFIT),
          }
        : null,
      balance: balance
        ? {
            totalAssets: finite(balance.TOTAL_ASSETS),
            monetaryFunds: finite(balance.MONETARYFUNDS),
            inventory: finite(balance.INVENTORY),
            totalLiabilities: finite(balance.TOTAL_LIABILITIES),
            totalEquity: finite(balance.TOTAL_EQUITY),
            debtAssetRatio: finite(balance.DEBT_ASSET_RATIO),
          }
        : null,
      cashFlow: cashFlow
        ? {
            operatingCashFlow: finite(cashFlow.NETCASH_OPERATE),
            investingCashFlow: finite(cashFlow.NETCASH_INVEST),
            financingCashFlow: finite(cashFlow.NETCASH_FINANCE),
            cashIncrease: finite(cashFlow.CCE_ADD),
            endingCash: finite(cashFlow.END_CCE),
          }
        : null,
    },
    missingStatements: missing,
  };
  const result: ProviderEvidence<unknown> = {
    data: income || balance || cashFlow ? data : null,
    asOf: reportDate,
  };
  const warnings = [...requestFailures];
  if (missing.length) warnings.push(`财务三表缺失：${missing.join("、")}`);
  if (warnings.length) result.warnings = warnings;
  return result;
}

export async function fetchEastmoneyShareholders(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  const rows = await fetchReportRows(
    instrument,
    "RPT_F10_EH_FREEHOLDERS",
    "SECUCODE",
    "END_DATE",
    context,
    20
  );
  const latestDate = text(rows[0]?.END_DATE);
  const latestRows = latestDate
    ? rows.filter((row) => text(row.END_DATE) === latestDate)
    : rows;
  const topHolders = latestRows.slice(0, 10).flatMap((row) => {
    const name = text(row.HOLDER_NAME);
    if (!name) return [];
    return [
      {
        rank: finite(row.HOLDER_RANK),
        name,
        shares: finite(row.HOLD_NUM),
        ratioPercent: finite(row.HOLD_RATIO),
        change: text(row.HOLD_NUM_CHANGE) ?? text(row.HOLDER_STATE),
        holderType: text(row.HOLDER_TYPE),
        marketValue: finite(row.HOLDER_MARKET_CAP),
      },
    ];
  });
  const result: ProviderEvidence<unknown> = {
    data: topHolders.length ? { reportDate: latestDate, topHolders } : null,
    asOf: latestDate ?? context.now().toISOString(),
  };
  if (rows.length && topHolders.length < 10)
    result.warnings = [`最新报告期仅返回 ${topHolders.length} 名流通股东`];
  return result;
}

export async function fetchEastmoneyDividend(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  const rows = await fetchReportRows(
    instrument,
    "RPT_SHAREBONUS_DET",
    "SECURITY_CODE",
    "REPORT_DATE",
    context,
    20
  );
  const history = rows.flatMap((row) => {
    const reportDate = text(row.REPORT_DATE);
    if (!reportDate) return [];
    return [
      {
        reportDate,
        noticeDate: text(row.PLAN_NOTICE_DATE) ?? text(row.NOTICE_DATE),
        recordDate: text(row.EQUITY_RECORD_DATE),
        exDividendDate: text(row.EX_DIVIDEND_DATE),
        cashDividendPer10Shares: finite(row.PRETAX_BONUS_RMB),
        bonusSharesPer10: finite(row.BONUS_RATIO),
        capitalizationPer10:
          finite(row.CAPITALIZATION_RATIO) ?? finite(row.IT_RATIO),
        totalShares: finite(row.TOTAL_SHARES),
        progress: text(row.ASSIGN_PROGRESS) ?? text(row.IMPLEMENT_PROGRESS),
        planSummary: text(row.IMPL_PLAN_PROFILE),
      },
    ];
  });
  return {
    data: history.length ? { history } : null,
    asOf: history[0]?.reportDate ?? context.now().toISOString(),
  };
}

export async function fetchEastmoneyMoneyFlow(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  const secid = securityId(instrument);
  if (!secid)
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["东方财富资金流仅支持沪深 A 股"],
    };
  const url = new URL(
    "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
  );
  url.searchParams.set("secid", secid);
  url.searchParams.set("lmt", "20");
  url.searchParams.set("klt", "101");
  url.searchParams.set("fields1", "f1,f2,f3,f7");
  url.searchParams.set(
    "fields2",
    "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65"
  );
  url.searchParams.set("ut", "b2884a393a59ad64002292a3e90d46a5");
  const payload = await fetchJson(url, context);
  const rows = Array.isArray(record(payload.data)?.klines)
    ? (record(payload.data)!.klines as unknown[])
    : [];
  const series = rows.flatMap((value) => {
    if (typeof value !== "string") return [];
    const fields = value.split(",");
    if (!fields[0]) return [];
    return [
      {
        date: fields[0],
        mainNetInflow: finite(fields[1]),
        smallNetInflow: finite(fields[2]),
        mediumNetInflow: finite(fields[3]),
        largeNetInflow: finite(fields[4]),
        superLargeNetInflow: finite(fields[5]),
        mainNetPercent: finite(fields[6]),
        close: finite(fields[11]),
        changePercent: finite(fields[12]),
      },
    ];
  });
  return {
    data: series.length ? { series } : null,
    asOf: series.at(-1)?.date ?? context.now().toISOString(),
  };
}

export async function fetchEastmoneyNews(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  const url = new URL("https://search-api-web.eastmoney.com/search/jsonp");
  url.searchParams.set("cb", "callback");
  url.searchParams.set(
    "param",
    JSON.stringify({
      uid: "",
      keyword: instrument.name || instrument.symbol,
      type: ["cmsArticleWebOld"],
      client: "web",
      clientType: "web",
      clientVersion: "curr",
      param: {
        cmsArticleWebOld: {
          searchScope: "default",
          sort: "default",
          pageIndex: 1,
          pageSize: 10,
          preTag: "<em>",
          postTag: "</em>",
        },
      },
    })
  );
  const raw = await fetchText(url, context);
  const first = raw.indexOf("(");
  const last = raw.lastIndexOf(")");
  const payload = record(
    JSON.parse(first >= 0 && last > first ? raw.slice(first + 1, last) : raw)
  );
  const rows = Array.isArray(record(payload?.result)?.cmsArticleWebOld)
    ? (record(payload?.result)!.cmsArticleWebOld as unknown[])
    : [];
  const items = rows.flatMap((value) => {
    const row = record(value);
    const title = stripHtml(row?.title);
    const itemUrl = text(row?.url);
    if (!title || !itemUrl) return [];
    return [
      {
        id: text(row?.code) ?? itemUrl,
        title,
        publishedAt: text(row?.date),
        url: itemUrl.replace(/^http:/, "https:"),
        summary: stripHtml(row?.content),
        source: text(row?.mediaName) ?? "东方财富",
      },
    ];
  });
  return {
    data: items.length ? { items } : null,
    asOf: items[0]?.publishedAt ?? context.now().toISOString(),
    warnings: ["新闻按公司名称检索，可能包含非证券唯一匹配结果"],
  };
}

function extractNoticeHtmlContent(html: string): string | null {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const candidates = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<(?:div|section)[^>]+(?:id|class)=["'][^"']*(?:content|detail|article)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i,
  ];
  for (const candidate of candidates) {
    const content = stripHtml(candidate.exec(cleaned)?.[1]);
    if (content && content.length >= 80) return content.slice(0, 50_000);
  }
  return null;
}

function noticeContentNeedsAttachment(content: string | null): boolean {
  if (!content) return true;
  if (content.length < 20) return true;
  return /^(?:公告)?内容?详见附件[。.]?$/i.test(content.replace(/\s+/g, ""));
}

function parseJsonpRecord(raw: string): UnknownRecord {
  const trimmed = raw.trim();
  try {
    const parsed = record(JSON.parse(trimmed));
    if (parsed) return parsed;
  } catch {
    // Eastmoney's content endpoint normally wraps JSON in the requested callback.
  }
  const first = trimmed.indexOf("(");
  const last = trimmed.lastIndexOf(")");
  const parsed = record(
    JSON.parse(
      first >= 0 && last > first ? trimmed.slice(first + 1, last) : trimmed
    )
  );
  if (!parsed) throw new ProviderError("东方财富公告内容接口返回无效 JSONP");
  return parsed;
}

function normalizeNoticeAttachmentUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  if (candidate.startsWith("//")) return `https:${candidate}`;
  try {
    const url = new URL(candidate, "https://pdf.dfcfw.com/");
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

async function fetchEastmoneyNoticeContent(
  artCode: string,
  context: ProviderContext
): Promise<{
  title?: string;
  content: string | null;
  pdfUrl?: string;
  warnings: string[];
}> {
  const fetchPage = async (pageIndex: number) => {
    const url = new URL(
      "https://np-cnotice-stock.eastmoney.com/api/content/ann"
    );
    url.searchParams.set("art_code", artCode);
    url.searchParams.set("client_source", "web");
    url.searchParams.set("page_index", String(pageIndex));
    url.searchParams.set("cb", "callback");
    const payload = parseJsonpRecord(
      await fetchText(url, context, "https://data.eastmoney.com/notices/")
    );
    const data = record(payload.data) ?? record(payload.result);
    if (!data) throw new ProviderError("东方财富公告内容接口缺少 data");
    return data;
  };

  const firstPage = await fetchPage(1);
  const pageCount = Math.max(
    1,
    Math.min(
      20,
      Math.floor(
        finite(firstPage.page_size) ?? finite(firstPage.total_page) ?? 1
      )
    )
  );
  const pages: UnknownRecord[] = [firstPage];
  const warnings: string[] = [];
  for (let pageIndex = 2; pageIndex <= pageCount; pageIndex += 1) {
    try {
      pages.push(await fetchPage(pageIndex));
    } catch (error) {
      warnings.push(
        `公告正文第 ${pageIndex}/${pageCount} 页获取失败：${error instanceof Error ? error.message : String(error)}`
      );
      break;
    }
  }
  const content = pages
    .map((page) => stripHtml(page.notice_content))
    .filter((page): page is string => Boolean(page))
    .join("\n\n")
    .slice(0, 100_000);
  const result: {
    title?: string;
    content: string | null;
    pdfUrl?: string;
    warnings: string[];
  } = { content: content || null, warnings };
  const title = text(firstPage.notice_title);
  const attachments = Array.isArray(firstPage.attach_list)
    ? firstPage.attach_list.map(record).filter(Boolean)
    : [];
  const preferredAttachment =
    attachments.find((attachment) => text(attachment?.attach_type) === "0") ??
    attachments[0];
  const pdfUrl = normalizeNoticeAttachmentUrl(
    firstPage.attach_url_web ?? preferredAttachment?.attach_url
  );
  if (title) result.title = title;
  if (pdfUrl) result.pdfUrl = pdfUrl;
  return result;
}

export async function fetchEastmoneyNotices(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  if (instrument.market !== "CN")
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["东方财富公告首版仅支持 A 股"],
    };
  const url = new URL(
    "https://np-anotice-stock.eastmoney.com/api/security/ann"
  );
  url.searchParams.set("sr", "-1");
  url.searchParams.set("page_size", "20");
  url.searchParams.set("page_index", "1");
  url.searchParams.set("ann_type", "A");
  url.searchParams.set("client_source", "web");
  url.searchParams.set("stock_list", instrument.symbol);
  const payload = await fetchJson(url, context);
  const rows = Array.isArray(record(payload.data)?.list)
    ? (record(payload.data)!.list as unknown[])
    : [];
  const items = rows.flatMap((value) => {
    const row = record(value);
    const title = text(row?.title);
    const artCode = text(row?.art_code) ?? text(row?.artCode);
    if (!title || !artCode) return [];
    const pageUrl = `https://data.eastmoney.com/notices/detail/${instrument.symbol}/${artCode}.html`;
    return [
      {
        id: artCode,
        title,
        publishedAt: text(row?.notice_date) ?? text(row?.display_time),
        url: pageUrl,
        pageUrl,
        pdfUrl: null,
        summary: title,
        content: null,
        contentStatus: "summary-only",
        pdfUrlDerived: false,
      },
    ];
  });
  const enriched = await Promise.all(
    items.map(async (item, index) => {
      if (index >= 3) return { item, warnings: [] as string[] };
      try {
        const detail = await fetchEastmoneyNoticeContent(item.id, context);
        const detailedItem = {
          ...item,
          title: detail.title ?? item.title,
          pdfUrl: detail.pdfUrl ?? null,
        };
        const inlineContent = detail.content;
        if (!noticeContentNeedsAttachment(inlineContent)) {
          return {
            item: {
              ...detailedItem,
              content: inlineContent,
              contentStatus: "content-api",
            },
            warnings: detail.warnings,
          };
        }
        if (detail.pdfUrl) {
          try {
            const pdf = await fetchPdf(
              new URL(detail.pdfUrl),
              context,
              item.pageUrl
            );
            const extracted = await extractPdfPlainText(pdf);
            if (extracted.text.length >= 20) {
              return {
                item: {
                  ...detailedItem,
                  content: extracted.text,
                  contentStatus: "pdf-extracted",
                  pdfPages: extracted.totalPages,
                  pdfParsedPages: extracted.parsedPages,
                },
                warnings: [
                  ...detail.warnings,
                  ...(extracted.truncated
                    ? [
                        `公告 PDF 共 ${extracted.totalPages} 页，正文已按 ${extracted.parsedPages} 页或 100000 字符上限截断`,
                      ]
                    : []),
                ],
              };
            }
          } catch (pdfError) {
            return {
              item: inlineContent
                ? {
                    ...detailedItem,
                    content: inlineContent,
                    contentStatus: "content-api",
                  }
                : detailedItem,
              warnings: [
                ...detail.warnings,
                ...(inlineContent
                  ? ["公告内容接口仅返回过短或附件占位文本"]
                  : []),
                `${inlineContent ? "公告正文需附件补全" : "公告内容接口未返回正文"}，PDF 提取失败：${pdfError instanceof Error ? pdfError.message : String(pdfError)}`,
              ],
            };
          }
        }
        return {
          item: inlineContent
            ? {
                ...detailedItem,
                content: inlineContent,
                contentStatus: "content-api",
              }
            : detailedItem,
          warnings: [
            ...detail.warnings,
            inlineContent
              ? "公告内容接口仅返回过短或附件占位文本，且未提供可解析的 PDF 附件"
              : "公告内容接口未返回正文，且未提供可解析的 PDF 附件",
          ],
        };
      } catch (contentError) {
        try {
          const html = await fetchText(
            new URL(item.pageUrl),
            context,
            "https://data.eastmoney.com/notices/"
          );
          const content = extractNoticeHtmlContent(html);
          if (content) {
            return {
              item: { ...item, content, contentStatus: "html-extracted" },
              warnings: ["公告内容接口不可用，已回退提取公告页面 HTML"],
            };
          }
        } catch {
          // Preserve the list evidence and report the failed enrichment below.
        }
        return {
          item,
          warnings: [
            `公告正文提取失败：${contentError instanceof Error ? contentError.message : String(contentError)}`,
          ],
        };
      }
    })
  );
  const enrichedItems = enriched.map((entry) => entry.item);
  const enrichmentWarnings = enriched.flatMap((entry) => entry.warnings);
  if (items.length > 3) {
    enrichmentWarnings.push(
      `为限制网络与解析开销，仅提取前 3 条公告正文；其余 ${items.length - 3} 条保留标题与详情页`
    );
  }
  const result: ProviderEvidence<unknown> = {
    data: enrichedItems.length ? { items: enrichedItems } : null,
    asOf: enrichedItems[0]?.publishedAt ?? context.now().toISOString(),
  };
  if (enrichmentWarnings.length) result.warnings = enrichmentWarnings;
  return result;
}

function htmlValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<th[^>]*>\\s*${escaped}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`,
    "i"
  ).exec(html);
  return stripHtml(match?.[1]);
}

function parseHoldingsScript(raw: string): string {
  const equals = raw.indexOf("=");
  if (equals < 0) return raw;
  const json = raw
    .slice(equals + 1)
    .trim()
    .replace(/;$/, "");
  return text(record(JSON.parse(json))?.content) ?? "";
}

export async function fetchEastmoneyEtf(
  instrument: InstrumentRef,
  context: ProviderContext
): Promise<ProviderEvidence<unknown>> {
  if (instrument.market !== "CN" || instrument.assetType !== "etf") {
    return {
      data: null,
      asOf: context.now().toISOString(),
      warnings: ["ETF 研究仅支持 A 股 ETF"],
    };
  }
  const profileUrl = new URL(
    `https://fundf10.eastmoney.com/jbgk_${instrument.symbol}.html`
  );
  const navUrl = new URL("https://api.fund.eastmoney.com/f10/lsjz");
  navUrl.searchParams.set("fundCode", instrument.symbol);
  navUrl.searchParams.set("pageIndex", "1");
  navUrl.searchParams.set("pageSize", "20");
  navUrl.searchParams.set("startDate", "");
  navUrl.searchParams.set("endDate", "");
  const holdingsUrl = new URL(
    "https://fundf10.eastmoney.com/FundArchivesDatas.aspx"
  );
  holdingsUrl.searchParams.set("type", "jjcc");
  holdingsUrl.searchParams.set("code", instrument.symbol);
  holdingsUrl.searchParams.set("topline", "10");
  holdingsUrl.searchParams.set("year", "");
  holdingsUrl.searchParams.set("month", "");

  const [profileResult, navResult, holdingsResult] = await Promise.allSettled([
    fetchText(profileUrl, context, "https://fundf10.eastmoney.com/"),
    fetchJson(navUrl, context, "https://fundf10.eastmoney.com/"),
    fetchText(holdingsUrl, context, "https://fundf10.eastmoney.com/"),
  ]);
  const warnings: string[] = [];
  const profileHtml =
    profileResult.status === "fulfilled" ? profileResult.value : "";
  if (!profileHtml) warnings.push("ETF profile 获取失败");
  const profile = profileHtml
    ? {
        fullName: htmlValue(profileHtml, "基金全称") ?? instrument.name,
        manager: htmlValue(profileHtml, "基金管理人"),
        custodian: htmlValue(profileHtml, "基金托管人"),
        establishedAt: htmlValue(profileHtml, "成立日期"),
        benchmark:
          htmlValue(profileHtml, "跟踪标的") ??
          htmlValue(profileHtml, "业绩比较基准"),
        sourceUrl: profileUrl.toString(),
      }
    : null;

  const navPayload =
    navResult.status === "fulfilled" ? navResult.value : undefined;
  const navList = record(navPayload?.Data)?.LSJZList;
  const navRows = Array.isArray(navList) ? navList : [];
  const nav = navRows.flatMap((value) => {
    const row = record(value);
    const date = text(row?.FSRQ);
    const unitNav = finite(row?.DWJZ);
    if (!date || unitNav === undefined) return [];
    return [
      {
        date,
        nav: unitNav,
        accumulatedNav: finite(row?.LJJZ),
        changePercent: finite(row?.JZZZL),
      },
    ];
  });
  if (!nav.length) warnings.push("ETF NAV 获取失败或为空");

  let holdingsHtml = "";
  if (holdingsResult.status === "fulfilled") {
    try {
      holdingsHtml = parseHoldingsScript(holdingsResult.value);
    } catch {
      holdingsHtml = "";
    }
  }
  const holdings = [
    ...holdingsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi),
  ].flatMap((match) => {
    const cells = [...match[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (cell) => stripHtml(cell[1]) ?? ""
    );
    const symbolIndex = cells.findIndex((cell) => /^\d{6}$/.test(cell));
    if (symbolIndex < 0) return [];
    const symbol = cells[symbolIndex]!;
    const name = cells[symbolIndex + 1];
    const weight = finite(
      cells.find((cell) => /%$/.test(cell))?.replace("%", "")
    );
    const numericCells = cells
      .slice(symbolIndex + 2)
      .map((cell) => finite(cell.replaceAll(",", "")))
      .filter((value) => value !== undefined);
    return [
      {
        symbol,
        name,
        weightPercent: weight,
        shares:
          numericCells.at(-2) === undefined
            ? undefined
            : numericCells.at(-2)! * 10_000,
        marketValueCny:
          numericCells.at(-1) === undefined
            ? undefined
            : numericCells.at(-1)! * 10_000,
        reportDate: undefined,
        originalUnit: "万股/万元",
      },
    ];
  });
  if (!holdings.length) warnings.push("ETF holdings 获取失败或为空");
  const data =
    profile || nav.length || holdings.length
      ? { profile, nav, holdings }
      : null;
  const result: ProviderEvidence<unknown> = {
    data,
    asOf: nav[0]?.date ?? context.now().toISOString(),
  };
  if (warnings.length) result.warnings = warnings;
  return result;
}

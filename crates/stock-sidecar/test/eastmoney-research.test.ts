import assert from "node:assert/strict";
import test from "node:test";

import { createStockResearchService, makeInstrument } from "../src/index.ts";
import { extractPdfPlainText } from "../src/pdf-text.ts";

const instrument = makeInstrument(
  "CN",
  "600519",
  "SSE",
  "EQUITY",
  "CNY",
  "贵州茅台"
);

function createTextPdf(text: string): Uint8Array {
  const textOperations = (text.match(/.{1,40}/g) ?? [])
    .map((chunk, index) => `${index ? "0 -20 Td " : ""}(${chunk}) Tj`)
    .join(" ");
  const stream = `BT /F1 18 Tf 72 720 Td ${textOperations} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "ascii"));
}

test("PDF extraction reports deterministic character truncation metadata", async () => {
  const result = await extractPdfPlainText(createTextPdf("A".repeat(1_500)), {
    maxChars: 1_000,
  });

  assert.equal(result.totalPages, 1);
  assert.equal(result.parsedPages, 1);
  assert.equal(result.text.length, 1_000);
  assert.equal(result.truncated, true);
});

test("Eastmoney research normalizes profile, three statements, money flow, news, and notices", async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/CompanySurvey/PageAjax")) {
      return Response.json({
        jbzl: [
          {
            SECURITY_CODE: "600519",
            SECURITY_NAME_ABBR: "贵州茅台",
            ORG_NAME: "贵州茅台酒股份有限公司",
            EM2016: "白酒",
            ORG_PROFILE: "白酒生产企业",
            ORG_WEB: "https://www.moutaichina.com",
            LISTING_DATE: "2001-08-27",
          },
        ],
      });
    }
    if (url.hostname.includes("datacenter")) {
      const reportName = url.searchParams.get("reportName");
      const rows: Record<string, unknown> = {
        SECURITY_CODE: "600519",
        REPORT_DATE: "2025-12-31",
      };
      if (reportName === "RPT_DMSK_FN_INCOME")
        Object.assign(rows, {
          TOTAL_OPERATE_INCOME: 180000000000,
          NETPROFIT: 90000000000,
        });
      if (reportName === "RPT_DMSK_FN_BALANCE")
        Object.assign(rows, {
          TOTAL_ASSETS: 320000000000,
          TOTAL_LIABILITIES: 48000000000,
        });
      if (reportName === "RPT_DMSK_FN_CASHFLOW")
        Object.assign(rows, {
          NETCASH_OPERATE: 95000000000,
          NETCASH_INVEST: -12000000000,
        });
      if (reportName === "RPT_F10_EH_FREEHOLDERS")
        Object.assign(rows, {
          END_DATE: "2026-03-31",
          HOLDER_NAME: "中国证券金融股份有限公司",
          HOLD_NUM: 8000000,
          HOLD_RATIO: 0.64,
          HOLDER_RANK: 1,
          HOLDER_TYPE: "机构",
        });
      if (reportName === "RPT_SHAREBONUS_DET")
        Object.assign(rows, {
          REPORT_DATE: "2025-12-31",
          PLAN_NOTICE_DATE: "2026-04-01",
          EX_DIVIDEND_DATE: "2026-06-20",
          PRETAX_BONUS_RMB: 30.876,
          TOTAL_SHARES: 1252270215,
          ASSIGN_PROGRESS: "实施方案",
        });
      const data =
        reportName === "RPT_F10_EH_FREEHOLDERS"
          ? Array.from({ length: 10 }, (_, index) => ({
              ...rows,
              HOLDER_RANK: index + 1,
              HOLDER_NAME: index === 0 ? rows.HOLDER_NAME : `股东${index + 1}`,
            }))
          : [rows];
      return Response.json({ result: { data } });
    }
    if (url.pathname.includes("/fflow/daykline/get")) {
      return Response.json({
        data: { klines: ["2026-07-15,100,40,20,10,30,10,5,2,3,1,0.5,0.2"] },
      });
    }
    if (url.hostname === "np-anotice-stock.eastmoney.com") {
      return Response.json({
        data: {
          list: [
            {
              title: "年度报告",
              notice_date: "2026-04-01",
              art_code: "AN202604010001",
              display_time: "2026-04-01 08:00:00",
            },
          ],
        },
      });
    }
    if (url.hostname === "np-cnotice-stock.eastmoney.com") {
      const page = Number(url.searchParams.get("page_index"));
      const payload = {
        data: {
          notice_title: "年度报告",
          notice_content:
            page === 1
              ? "<p>年度报告正文第一页。</p>"
              : "<p>年度报告正文第二页。</p>",
          attach_url_web: "https://pdf.dfcfw.com/pdf/H2_AN202604010001_1.pdf",
          attach_type: "pdf",
          page_size: 2,
        },
      };
      return new Response(`callback(${JSON.stringify(payload)})`);
    }
    if (
      url.hostname === "data.eastmoney.com" &&
      url.pathname.includes("/notices/detail/")
    ) {
      return new Response(
        `<html><article>${"年度报告正文内容。".repeat(20)}</article></html>`
      );
    }
    if (url.hostname === "search-api-web.eastmoney.com") {
      const payload = {
        result: {
          cmsArticleWebOld: [
            {
              title: "贵州茅台发布经营数据",
              date: "2026-07-15 09:00:00",
              url: "https://finance.eastmoney.com/a/1.html",
              content: "公司披露主要经营数据。",
            },
          ],
        },
      };
      return new Response(`callback(${JSON.stringify(payload)})`);
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const service = createStockResearchService({
    fetch: fetchMock,
    now: () => new Date("2026-07-15T10:00:00.000Z"),
  });

  const result = await service.research({
    instrument,
    capabilities: [
      "profile",
      "financials",
      "shareholders",
      "dividend",
      "moneyFlow",
      "news",
      "notices",
    ],
  });
  const sections = (
    result.data as {
      capabilities: Record<string, { status: string; data: any }>;
    }
  ).capabilities;

  assert.equal(result.status, "partial");
  assert.equal(sections.profile!.status, "ok");
  assert.equal(sections.profile!.data.industry, "白酒");
  assert.equal(sections.financials!.status, "ok");
  assert.equal(
    sections.financials!.data.statements.income.netProfit,
    90000000000
  );
  assert.equal(
    sections.financials!.data.statements.balance.totalAssets,
    320000000000
  );
  assert.equal(
    sections.financials!.data.statements.cashFlow.operatingCashFlow,
    95000000000
  );
  assert.equal(sections.moneyFlow!.data.series[0].mainNetInflow, 100);
  assert.equal(sections.shareholders!.status, "ok");
  assert.equal(
    sections.shareholders!.data.topHolders[0].name,
    "中国证券金融股份有限公司"
  );
  assert.equal(sections.dividend!.status, "ok");
  assert.equal(
    sections.dividend!.data.history[0].cashDividendPer10Shares,
    30.876
  );
  assert.equal(
    sections.news!.data.items[0].url,
    "https://finance.eastmoney.com/a/1.html"
  );
  assert.equal(sections.notices!.status, "ok");
  assert.equal(
    sections.notices!.data.items[0].pdfUrl,
    "https://pdf.dfcfw.com/pdf/H2_AN202604010001_1.pdf"
  );
  assert.equal(sections.notices!.data.items[0].pdfUrlDerived, false);
  assert.match(sections.notices!.data.items[0].content, /正文第一页/);
  assert.match(sections.notices!.data.items[0].content, /正文第二页/);
  assert.equal(sections.notices!.data.items[0].contentStatus, "content-api");
});

test("financials preserve successful statements when one Eastmoney statement endpoint fails", async () => {
  const service = createStockResearchService({
    fetch: async (input) => {
      const url = new URL(String(input));
      const reportName = url.searchParams.get("reportName");
      if (reportName === "RPT_DMSK_FN_BALANCE")
        return new Response("failed", { status: 503 });
      if (reportName === "RPT_DMSK_FN_INCOME")
        return Response.json({
          result: { data: [{ REPORT_DATE: "2025-12-31", NETPROFIT: 10 }] },
        });
      if (reportName === "RPT_DMSK_FN_CASHFLOW")
        return Response.json({
          result: {
            data: [{ REPORT_DATE: "2025-12-31", NETCASH_OPERATE: 12 }],
          },
        });
      throw new Error(`unexpected URL: ${url}`);
    },
  });
  const result = await service.research({
    instrument,
    capabilities: ["financials"],
  });
  const section = (
    result.data as {
      capabilities: Record<string, { status: string; data: any }>;
    }
  ).capabilities.financials!;
  assert.equal(result.status, "partial");
  assert.equal(section.status, "partial");
  assert.equal(section.data.statements.income.netProfit, 10);
  assert.equal(section.data.statements.balance, null);
  assert.equal(section.data.statements.cashFlow.operatingCashFlow, 12);
});

test("notices extract a real PDF attachment when the content API has no inline body", async () => {
  const pdf = createTextPdf("PDF notice body with enough content");
  const service = createStockResearchService({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "np-anotice-stock.eastmoney.com") {
        return Response.json({
          data: {
            list: [
              {
                title: "PDF 公告",
                notice_date: "2026-04-02",
                art_code: "AN202604020001",
              },
            ],
          },
        });
      }
      if (url.hostname === "np-cnotice-stock.eastmoney.com") {
        return new Response(
          `callback(${JSON.stringify({
            data: {
              notice_title: "PDF 公告",
              notice_content: "",
              attach_url_web: "https://example.com/notice.pdf",
              attach_type: "pdf",
              page_size: 1,
            },
          })})`
        );
      }
      if (url.href === "https://example.com/notice.pdf") {
        return new Response(pdf.buffer as ArrayBuffer, {
          headers: { "Content-Type": "application/pdf" },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  const result = await service.research({
    instrument,
    capabilities: ["notices"],
  });
  const section = (
    result.data as {
      capabilities: Record<string, { status: string; data: any }>;
    }
  ).capabilities.notices!;

  assert.equal(section.status, "ok", JSON.stringify(section));
  assert.equal(section.data.items[0].pdfUrl, "https://example.com/notice.pdf");
  assert.equal(section.data.items[0].contentStatus, "pdf-extracted");
  assert.match(section.data.items[0].content, /PDF notice body/);
});

test("notices preserve retrieved pages when a later content page fails", async () => {
  const service = createStockResearchService({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "np-anotice-stock.eastmoney.com") {
        return Response.json({
          data: {
            list: [
              {
                title: "分页公告",
                notice_date: "2026-04-03",
                art_code: "AN202604030001",
              },
            ],
          },
        });
      }
      if (url.hostname === "np-cnotice-stock.eastmoney.com") {
        if (url.searchParams.get("page_index") === "2") {
          return new Response("unavailable", { status: 503 });
        }
        return new Response(
          `callback(${JSON.stringify({
            data: {
              notice_title: "分页公告",
              notice_content: "<p>已获取的第一页正文内容足够长。</p>",
              page_size: 3,
            },
          })})`
        );
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  const result = await service.research({
    instrument,
    capabilities: ["notices"],
  });
  const section = (
    result.data as {
      capabilities: Record<
        string,
        { status: string; data: any; warnings: string[] }
      >;
    }
  ).capabilities.notices!;

  assert.equal(section.status, "partial");
  assert.match(section.data.items[0].content, /第一页正文/);
  assert.equal(section.data.items[0].contentStatus, "content-api");
  assert.match(section.warnings.join("\n"), /第 2\/3 页获取失败/);
});

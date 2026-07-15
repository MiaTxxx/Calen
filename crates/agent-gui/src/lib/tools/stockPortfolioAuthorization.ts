const PORTFOLIO_TERMS =
  /(?:持仓|仓位|投资组合|组合|交易流水|交易记录|自选股|自选列表|盈亏|成本价|portfolio|holdings?|positions?|transactions?|watchlist)/i;
const PORTFOLIO_ACTION =
  /(?:分析|查看|读取|检查|评估|汇总|列出|展示|计算|show|read|analy[sz]e|review|check|summari[sz]e|list|calculate)/i;
const PORTFOLIO_DENIAL = /(?:不要|别|禁止|无需|不允许|不授权|do not|don't|never|without)/i;
const LOCAL_PORTFOLIO_REFERENCE =
  /(?:(?:我的|本人(?:的)?|本地(?:保存|记录)?(?:的)?|这个|该|当前(?:的)?|现有(?:的)?|已选(?:中)?(?:的)?|上述|Calen\s*(?:中|里|内|本地)?(?:保存|记录)?(?:的)?)(?:投资组合|组合|持仓|仓位|交易流水|交易记录|自选股|自选列表|盈亏|成本价)|(?:my|mine|local|this|current|selected|saved|in\s+Calen)\s+(?:portfolio|holdings?|positions?|transactions?|watchlist))/i;

export type StockPortfolioRequestOrigin = "local" | "gateway";

/** Private-by-default authorization for the current user turn. */
export function isExplicitStockPortfolioRequest(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return normalized
    .split(/[，。；;.!?！？\n]+/)
    .some(
      (clause) =>
        PORTFOLIO_TERMS.test(clause) &&
        PORTFOLIO_ACTION.test(clause) &&
        LOCAL_PORTFOLIO_REFERENCE.test(clause) &&
        !PORTFOLIO_DENIAL.test(clause),
    );
}

/** Gateway-originated turns never receive access to the local asset ledger. */
export function isStockPortfolioReadAuthorized(params: {
  latestUserText: string;
  origin: StockPortfolioRequestOrigin;
}): boolean {
  return params.origin === "local" && isExplicitStockPortfolioRequest(params.latestUserText);
}

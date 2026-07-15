const PORTFOLIO_TERMS =
  /(?:持仓|仓位|投资组合|组合分析|交易流水|交易记录|自选股|自选列表|盈亏|成本价|portfolio|holdings?|positions?|transactions?|watchlist)/i;
const PORTFOLIO_ACTION =
  /(?:分析|查看|读取|检查|评估|汇总|列出|展示|计算|show|read|analy[sz]e|review|check|summari[sz]e|list|calculate)/i;
const PORTFOLIO_DENIAL = /(?:不要|别|禁止|无需|不允许|不授权|do not|don't|never|without)/i;

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
        !PORTFOLIO_DENIAL.test(clause),
    );
}

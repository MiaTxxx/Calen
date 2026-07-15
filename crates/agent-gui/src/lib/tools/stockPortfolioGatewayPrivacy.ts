export const STOCK_PORTFOLIO_TOOL_NAME = "StockPortfolioRead";

export const STOCK_PORTFOLIO_PRIVACY_NOTICE =
  "Calen kept this local portfolio result on the desktop and did not send asset data to Gateway.";

export function isPrivateStockPortfolioToolName(value: unknown): boolean {
  return value === STOCK_PORTFOLIO_TOOL_NAME;
}

export function stockPortfolioGatewayPlaceholderArguments(): Record<string, unknown> {
  return {
    localOnly: true,
    redacted: true,
  };
}

export function stockPortfolioGatewayPlaceholderContent(): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: STOCK_PORTFOLIO_PRIVACY_NOTICE }];
}

export function stockPortfolioGatewayPlaceholderDetails(): Record<string, unknown> {
  return {
    kind: "stock_result",
    operation: "portfolio",
    status: "unavailable",
    localOnly: true,
    redacted: true,
    warnings: ["本地资产数据未发送到 Gateway。"],
    result: null,
  };
}

export function redactPrivateStockPortfolioGatewayEvent(
  event: Record<string, unknown>,
): Record<string, unknown> {
  if (!isPrivateStockPortfolioToolName(event.name)) return event;
  const type = event.type;
  if (type === "tool_call" || type === "tool_call_delta") {
    return {
      ...event,
      arguments: stockPortfolioGatewayPlaceholderArguments(),
    };
  }
  if (type !== "tool_result") return event;
  return {
    ...event,
    arguments: stockPortfolioGatewayPlaceholderArguments(),
    content: stockPortfolioGatewayPlaceholderContent(),
    details: stockPortfolioGatewayPlaceholderDetails(),
  };
}

export function redactPortfolioDerivedGatewayEvent(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const type = event.type;
  if (type === "tool_call" || type === "tool_call_delta") {
    return {
      ...event,
      arguments: stockPortfolioGatewayPlaceholderArguments(),
      localOnly: true,
      redacted: true,
    };
  }
  if (type === "tool_result") {
    return {
      ...event,
      arguments: stockPortfolioGatewayPlaceholderArguments(),
      content: stockPortfolioGatewayPlaceholderContent(),
      details: stockPortfolioGatewayPlaceholderDetails(),
      localOnly: true,
      redacted: true,
    };
  }
  if (type === "token") {
    return {
      ...event,
      text: event.title ? "" : STOCK_PORTFOLIO_PRIVACY_NOTICE,
      ...(event.title ? { title: "本地组合分析" } : {}),
      localOnly: true,
      redacted: true,
    };
  }
  if (type === "thinking") {
    return {
      ...event,
      text: STOCK_PORTFOLIO_PRIVACY_NOTICE,
      localOnly: true,
      redacted: true,
    };
  }
  if (type === "tool_status") {
    return {
      ...event,
      status: "本地组合分析",
      localOnly: true,
      redacted: true,
    };
  }
  if (type === "error") {
    return {
      ...event,
      message: "本地组合分析详情未发送到 Gateway。",
      localOnly: true,
      redacted: true,
    };
  }
  if (type === "hosted_search") {
    return {
      type,
      id: event.id,
      round: event.round,
      conversation_id: event.conversation_id,
      localOnly: true,
      redacted: true,
    };
  }
  return event;
}

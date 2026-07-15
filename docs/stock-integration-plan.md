# Calen 股票能力集成路线

## 目标

以 Calen 为唯一主工程，逐步加入 Opptrix 中的股票搜索、行情、基本面、新闻和研究能力。Calen 的通用 Agent、桌面权限、Memory、Skills、MCP、Gateway 和现有 UI 继续作为产品基座；Opptrix 只贡献股票领域模块和数据 Provider 经验。

## 结论先行

采用“两阶段接缝”：

1. **集成验证阶段**：使用 Opptrix 已有的 `packages/agent/src/mcp/stdio-entry.ts`，通过 Calen 的 MCP 设置接入 `opptrix-mcp`。只暴露股票只读工具，快速验证数据源、模型调用和用户体验。
2. **产品化阶段**：把股票领域收敛为一个独立的 `StockResearch` 深模块。MCP/stdio 只是生产 adapter；测试使用内存 adapter；高频只读能力在稳定后才考虑做成 Calen 原生 Builtin Tool。

不要把 Opptrix 的完整 `client-ui`、Fastify server、Electron 壳、AgentEngine 或多市场投研 UI 复制进 Calen。

## 推荐的深模块 interface

```ts
type StockCapability =
  | "quote"
  | "profile"
  | "history"
  | "financials"
  | "news"
  | "notices"
  | "technical";

interface StockResearch {
  search(input: StockSearchInput): Promise<InstrumentRef[]>;
  query<C extends StockCapability>(
    request: StockQueryRequest<C>,
  ): Promise<EvidenceResult<C>>;
  brief(request: StockBriefRequest): Promise<ResearchBundle>;
}
```

interface 的不变量：

- `InstrumentRef` 是跨市场稳定标识，不能把单一 Provider 的代码格式泄漏给调用方。
- 所有结果包含 `source`、`asOf`、`retrievedAt`、`cached` 和 `warnings`；没有可靠数据时返回结构化失败，不编造结论。
- `query` 只做读操作；交易、下单、修改关注列表和写入用户笔记不属于首版。
- 每个 Provider 有独立 deadline；整体请求要能响应 Calen 的取消状态。
- 大 K 线、新闻和财务表默认分页或限制条数，不把无界原始数据塞进模型上下文。

这个 interface 是领域 seam。Provider SDK、Opptrix 数据格式、缓存、限流、健康评分、故障回退和来源归一化都藏在 implementation 后面。

## 现有接入点与证据

Calen 已具备所需的 transport seam：

- 动态 MCP 工具加载：`crates/agent-gui/src/lib/tools/mcpTools.ts`
- MCP Server 配置：`crates/agent-gui/src/lib/settings/index.ts`
- stdio/HTTP/SSE 生命周期、超时和进程树清理：`crates/agent-gui/src-tauri/src/commands/integration/mcp.rs`
- Builtin Tool 组装：`crates/agent-gui/src/lib/tools/builtinRegistry.ts`

Opptrix 已具备可直接验证的 MCP adapter：

- stdio 入口：`packages/agent/src/mcp/stdio-entry.ts`
- MCP server：`packages/agent/src/mcp/server.ts`
- 研究门面：`packages/research-hub/src/hub.ts`
- 统一数据入口：`packages/a-stock-layer/src/engine.ts` 中的 `queryInstrumentData`
- 工具实现与工具包：`packages/agent/src/tools.ts`、`packages/shared/src/tool-packs.ts`

## 阶段 0：只读集成验证

在 Opptrix 构建完成后，在 Calen 中登记一个 stdio MCP Server，开发期可指向：

```text
command: node
args: ["<Opptrix-main>/packages/agent/dist/mcp/stdio-entry.js", "--mining"]
cwd: <Opptrix-main>
```

`--mining` 只适合最早期的连通性 smoke test：它按 Opptrix 的 `miningEligible` 元数据暴露一组较大的工具，并不等于下面的最终 MVP 白名单（例如公告工具不在 mining 集合中）。进入用户验证前，应给 stdio 入口增加显式 profile/allowlist 参数，或增加一个 Calen 专用入口。

用户验证期只允许暴露以下 MVP 能力：

- `search_instruments`
- `get_instrument_profile`
- `get_instrument_chart`
- `get_instrument_financials`
- `get_instrument_notices`
- `get_market_dynamics`

验证标准：

- Calen Chat 能发现并调用这些 MCP tools。
- 工具失败、超时、空数据和来源都能在 transcript 中清楚呈现。
- 不暴露交易/写入工具，不把 Opptrix 的完整工具目录注入每轮上下文。
- 至少验证 CN 股票、ETF 和一个非 CN 市场的明确失败/能力边界。

这一阶段用于验证产品价值和数据质量，不是最终发布方案。它依赖 Opptrix 的 Node 运行时和整套 workspace，不能直接作为最终桌面安装包的运行时契约。

## 阶段 1：股票 sidecar 产品化

从 Opptrix 提取股票领域 implementation，形成 Calen 可管理的独立 Node sidecar 或独立可执行包：

```text
Calen Tauri
  ├─ StockResearch facade / lifecycle
  ├─ MCP stdio adapter
  └─ Stock sidecar process
       ├─ InstrumentRef + capability
       ├─ Provider registry / fallback / cache / rate limit
       └─ read-only stock tools
```

责任归属：

- Calen Tauri：进程启动/停止、超时、stderr 尾部、健康状态、密钥注入和用户可见错误。
- Sidecar：股票领域逻辑、Provider 选择、响应归一化、缓存和来源/时效元数据。
- Calen settings：Provider 凭据和启用项的权威来源；不要同时维护两套可编辑配置。
- Sidecar 数据目录：缓存和索引可放在 `~/.liveagent/stock-research/`，不得混入聊天历史数据库。

测试 adapter：

- `InMemoryStockProvider`：测试 `StockResearch` interface 的正常、空数据、超时和回退。
- `McpStockAdapter`：验证 list/call schema 和错误映射。
- Calen fake stdio server：验证 Tauri MCP 生命周期、取消、重启和工具目录刷新。

## 阶段 2：原生高频体验（可选）

当 sidecar interface 稳定后，只把最常用的只读能力做成 `crates/agent-gui/src/lib/tools/stockResearchTools.ts` 的 Builtin Tool，例如 `StockResolve`、`StockSnapshot`、`StockResearch`。这些工具仍调用同一个 `StockResearch` interface，不得绕过 sidecar/Provider seam。

原生工具的收益是短工具名、少一次 MCP tools/list、复用 Calen 的运行态详情；代价是与 Calen 发布周期耦合，并需要同步子代理权限、WebUI 镜像和测试。MCP 仍保留为扩展和开发 adapter。

## 明确不做的事

- 不复制 Opptrix 的完整 React 投研 UI、Fastify API、Electron 桌面壳。
- 不把 `ResearchHub` 的巨大 switch 或全部 `ToolRegistry` 直接作为 Calen 的领域 interface。
- 不把 Provider DTO、API key、内部缓存结构直接暴露给模型。
- 不在首版加入自动交易、下单或投资建议。
- 不默认把 A 股能力硬编码成唯一市场；能力不足必须显式返回支持范围。
- 不用单例的“当前会话”状态承载股票请求；每次请求必须有独立的 immutable run context。

## 质量门禁

每个阶段至少需要：

- interface contract tests，覆盖来源、时效、缓存、空数据、超时和回退；
- MCP list/call contract test；
- Calen MCP integration smoke test；
- Windows/macOS/Linux 进程启动和路径测试（进入 sidecar 阶段后）；
- 不把 API key、用户配置或实时行情写入 Git；
- 记录 Apache-2.0 来源代码的复制范围和归属。

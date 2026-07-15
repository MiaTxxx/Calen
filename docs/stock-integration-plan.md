# Calen 股票能力集成路线

## 产品边界

Calen 是唯一产品壳。Opptrix 仅作为股票领域设计与实现的来源，不迁移其 Electron、Fastify、完整 React UI、`ResearchHub` 巨型门面、DuckDB 数据湖或完整 MCP 工具表。

首版只发布 Windows x64，股票能力只读，不连接券商、不自动下单，也不提供保证收益或个性化投资建议。所有用户可见结果必须展示数据来源、数据截至时间、获取时间、缓存状态和不确定性；数据缺失时返回 `partial` 或 `unavailable`，禁止由模型补造。

## 目标能力

- A 股：标的搜索与消歧、快照、K 线、公司资料、财务事实、股东与分红、资金流、新闻、公告正文和市场专题。
- 港股与美股：首版提供搜索、快照、日 K 和有限公司资料，并明确 Provider 能力边界。
- ETF：统一作为资产类型处理；Provider 支持时展示净值、溢价和主要持仓。
- 市场：涨跌停、连板/热股、龙虎榜、板块、资金流、异动与市场情绪，支持按需生成盘前和收盘简报。
- 资产：本地自选、组合、交易流水、CSV 导入导出和多币种组合分析；AI 默认无权读取持仓，仅在用户明确要求组合分析时只读访问。
- 实验室：技术指标、评分、策略信号、Evaluator 和回测。所有结果显著标记“实验性研究”，附算法版本、参数、样本区间、基准、费用假设、覆盖率与限制。

## 稳定领域接口

```ts
interface StockResearchPort {
  resolve(request: StockResolveRequest): Promise<InstrumentSearchResult>;
  snapshot(request: StockSnapshotRequest): Promise<StockEvidenceResult>;
  research(request: StockResearchRequest): Promise<StockEvidenceResult>;
  marketBrief(request: MarketBriefRequest): Promise<StockEvidenceResult>;
  backtest(request: StockBacktestRequest): Promise<StockBacktestResult>;
  status(): Promise<StockServiceStatus>;
}
```

接口隐藏 Provider DTO、路由、缓存、限流、熔断、回退与凭据。`InstrumentRef` 是跨市场稳定标识；`StockEvidenceResult` 至少包含 `status`、`sources`、`asOf`、`retrievedAt`、`cached` 和 `warnings`。

AI 仅注册 `StockResolve`、`StockSnapshot`、`StockResearch`、`StockMarketBrief`、`StockBacktest` 和 `StockPortfolioRead` 六个高层工具。定时任务只能调用受限的研究与市场工具，子代理默认无股票权限，资产写入永不暴露给 AI。

## 运行架构

```text
Calen React UI / Chat tools
          |
Tauri StockResearchManager
  - JSON-RPC request、timeout、cancel
  - sidecar lifecycle、health、restart once
  - secret injection、stderr tail
          |
Node 24 stock-sidecar (stdio only)
  - InstrumentRef / capability normalization
  - provider registry / fallback / circuit breaker
  - cache / throttle / evidence metadata
  - analytics / evaluator / bounded backtest
```

sidecar 不开放 HTTP 端口。Windows 安装包携带精简 Node 24 x64 运行时与编译后的 sidecar，用户无需安装 Node。缓存与索引使用独立股票目录，不混入聊天数据库；首版不引入 DuckDB。

默认优先接入无需 Key 的腾讯、东方财富等免费来源，BaoStock、新浪等来源仅在实现及条款验证后启用；ZZShare、Tushare、TickFlow、Fuyao 等作为用户显式配置的可选 Provider。API Key 只进入本地秘密存储，不同步到 Gateway，也不写入日志或普通设置导出。

## Calen 原生体验

侧栏“股票研究”包含五个固定页面：研究、市场、自选与持仓、实验室、数据源。UI 复用 Calen 现有布局、卡片、抽屉、标签页和主题；K 线使用 `lightweight-charts` 的 Calen 主题封装，不复制 Opptrix 页面。

聊天股票结果卡展示证券身份、数据时间、来源、警告、关键数据和有限图表，原始数据折叠。研究简报区分可核验事实、正反论据、风险和待验证事项，不直接给出买卖指令。

资产流水支持买入、卖出、费用、分红、拆股和调整，采用含费用的加权平均成本法。CNY、HKD、USD 原币结果为权威值，组合汇总通过带时间戳的汇率换算。首版仅本地 SQLite，不连接真实券商、不跨设备同步。

## Windows 发布与验收

Release 仅构建 `x86_64-pc-windows-msvc`，公开资产固定为：

- `Calen-<tag>-Windows-x64-Setup.exe`
- `Calen-<tag>-Windows-x64.msi`
- Windows-only `latest.json`

安装器对应的 `.sig` 仅用于生成 Tauri updater manifest，不作为 GitHub Release 的公开资产。Tauri updater 私钥签名是发布门禁；首版无 Authenticode，Windows 可能显示“未知发布者”。不发布 portable、Linux 或 macOS 包。

验收至少覆盖：中文/空格安装路径、机器无系统 Node、离线、403/429、超时、取消、sidecar 崩溃与单次重启；Provider 回退、缓存、限流和部分失败；财务/公告字段归一化；资产流水和多币种盈亏；回测防未来数据、确定性和版本元数据；普通聊天不读取持仓，Gateway 不接收明文资产或 Provider Key。

## 来源、许可证与数据合规

Opptrix 为 Apache-2.0。直接复制或实质改编的代码必须保留原版权头、标明修改，并登记到 `THIRD_PARTY_NOTICES.md`；仅借鉴架构思想时也在 ADR 中记录来源路径。Calen 的 MIT 许可不覆盖第三方数据使用权。

每个 Provider 上线前必须单独审查服务条款、许可、地域限制、缓存/再分发限制和频率限制。未经确认的数据源不得默认启用或随安装包再分发。产品始终声明数据可能延迟或错误，内容仅供研究与信息参考，不构成投资建议。

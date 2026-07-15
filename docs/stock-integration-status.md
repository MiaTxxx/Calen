# Calen 股票融合实施状态

更新时间：2026-07-16

本文记录 `docs/stock-integration-plan.md` 的实际实现证据与剩余边界。它不是发布批准，也不能替代 Provider 条款、签名和真实安装验收。

## 已实现

### Sidecar 与数据层

- Node 24 单文件 JSON-RPC stdio sidecar；无 Fastify、本地 HTTP 和 DuckDB。
- `InstrumentRef`、`StockCapability`、`StockEvidenceResult` 与六方法稳定 `StockResearchPort`；内部 `StockFxRatePort.fxRates` 只服务组合换算，不注册为 AI 工具。
- Provider Registry：优先级、自动回退、TTL 缓存、请求前节流、403/429/5xx 冷却、熔断、取消和总超时。
- 默认腾讯行情与东方财富行情回退；可选新浪、BaoStock、ZZShare、Tushare、TickFlow、Fuyao。
- 腾讯外汇按需批量提供 USD/CNY、USD/HKD、HKD/CNY 及反向汇率；币对去重并复用 Registry 缓存，缺失行情返回 `partial/unavailable`。
- 沪深北 A 股行情、日 K、资料、最近 4 期有界财务三表（保留最新一期摘要并提供报告期覆盖）、主要股东、分红、资金流、新闻、公告 HTML/PDF 正文；ETF 净值/溢价/主要持仓和 A 股市场专题。
- 港美股代码解析、腾讯公司中英文名/模糊搜索、行情、日 K 与有限证券身份资料；显式启用新浪时提供名称搜索回退，TickFlow 启用时补充跨市场行情。
- 证据结果始终携带来源、截至时间、获取时间、缓存状态与警告；缺失能力返回 `partial/unavailable`。

### 量化实验

- SMA5/10/20/60、MACD、RSI、Bollinger、KDJ、CCI、Williams %R、OBV、ADX/+DI/-DI、波动率与量价指标。
- 趋势、均值回归、突破、动量、量价五策略 registry 和信号融合。
- 多维 Evaluator：趋势、动量、量价、风险、财务质量、完整度、时效、评级和置信度。
- SMA 交叉、五策略和融合策略回测；信号只使用当前及更早数据，在下一根 K 线开盘执行。
- 回测包含交易记录、基准、收益、回撤、费用假设、真实样本覆盖率、缺口警告、算法版本与限制。

### Calen 产品层

- 股票 Hub 五页：研究、市场、自选与持仓、实验室、数据源。
- `lightweight-charts` Calen 主题 K 线；研究页结构化展示财务三表、股东、分红、资金流、新闻、公告与 ETF 资料。
- 对话股票结果卡展示关键行情/回测指标、有限趋势图、来源、警告和独立折叠的原始 JSON。
- 六个高层 AI 工具；Cron 只有研究/市场工具，子代理默认无股票工具。
- `StockPortfolioRead` 要求当前用户请求明确指向“我的/本地/这个组合”等本地资产；Gateway 会话禁用该工具，实时事件、运行快照、历史投影以及组合工具后的模型复述/压缩摘要均脱敏。
- 本地 SQLite 支持自选分组、多组合、买入、卖出、费用、分红、拆股、调整、删除回滚、CSV、CSV 导入批次审计记录和密码加密备份。
- Hub 已接通组合创建/切换、自选管理、手工流水、按组合 CSV、自动行情与自动汇率估值；手工带时间戳汇率按币对覆盖自动值，自动汇率失败只追加警告并保留原币分析。
- 市场页可一键创建工作日 08:30 盘前报告与 15:30 收盘复盘任务，复用当前模型和受限股票工具。
- `stock_portfolio` 已预留两个未联网的 Rust 领域 seam：券商 adapter 只能读取标准化流水供用户显式导入，不能下单或直接改账本；Gateway adapter 只能推拉端到端加密 envelope，明文资产、券商凭据和同步密钥均不进入普通设置或 Gateway 接口。

### Windows 生命周期与发布

- Windows x64 only Release workflow；构建 NSIS Setup.exe、MSI、各自 updater `.sig` 和 Windows-only `latest.json`。
- 安装包携带 Node 24 x64、sidecar bundle、NOTICE 和许可证，不包含 `node_modules`。
- bundle verifier 在中文/空格路径和空 `PATH` 下直接运行 sidecar。
- Tauri updater 私钥、密码和公钥是强制门禁；Provider 条款批准变量也是发布门禁。
- Windows sidecar 使用 Job Object 进程树清理；更新、重启、退出均先停止 sidecar。

## 仍有限制或需外部验收

- 北交所当前 `920xxx` 代码已接入与沪深相同的东方财富个股深研路径；历史 `4/8` 开头旧代码仍按 BSE 识别，但代码切换关系不做静态猜测，旧代码失效时会返回 `partial/unavailable`，应按公司名称重新解析当前代码。市场专题仍是 A 股聚合视图，现有涨幅榜筛选器不宣称包含完整北交所分项。
- 港美股名称搜索依赖腾讯 smartbox；新浪可选回退的美股 suggestion 不提供可靠交易所和股票/ETF 分类，因此返回 `exchange=US`、`assetType=unknown` 与 `partial` 警告。离线时仍只能解析明确代码/ticker。
- 东方财富财务三表当前最多展示最近 4 个标准化报告期，不等同于完整财务数据库或长期数据湖。
- Sina、BaoStock 和所有 Key Provider 因独立条款尚未审批而默认关闭；这与原计划“默认使用全部免费源”存在合规驱动的有意偏差。
- 券商导入和端到端加密资产同步目前仅有领域端口与类型，尚无真实券商、密钥管理或 Gateway transport adapter，也未开放 Tauri 命令。
- 公开 Release、真实 updater 升级和最终安装验收仍需有效签名秘密与 `CALEN_STOCK_PROVIDER_TERMS_APPROVED=true`。
- 未取得书面 Provider 条款批准前，不得创建公开 Tag/Release 或上传安装包。

## 当前自动化验证

- Sidecar：93 项测试，覆盖回退、缓存、节流、熔断、403/429、离线、取消、自动汇率、ETF 溢价、公告 PDF、量化确定性与防未来函数。
- GUI 股票/结果卡：资产授权、Gateway 脱敏、五页 Hub、Tauri adapter、组合工作区、结构化研究和结果卡测试。
- Windows CI：bundle 隔离验证、Tauri backend check，并实际运行股票 Rust 测试。
- 发布 workflow 的安装器生命周期 smoke 只会在满足合规和签名门禁的正式 Windows 构建中执行。

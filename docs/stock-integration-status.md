# Calen 股票融合实施状态

更新时间：2026-07-18

本文记录 `docs/stock-integration-plan.md` 的实际实现证据与剩余边界。它不是发布批准，也不能替代 Provider 条款、签名和真实安装验收。

## 已实现

### Sidecar 与数据层

- Node 24 单文件 JSON-RPC stdio sidecar；无 Fastify、本地 HTTP 和 DuckDB。
- `InstrumentRef`、`StockCapability`、`StockEvidenceResult` 与六方法稳定 `StockResearchPort`；内部 `StockFxRatePort.fxRates` 只服务组合换算，不注册为 AI 工具。
- Provider Registry：优先级、自动回退、TTL 缓存、请求前节流、403/429/5xx 冷却、熔断、取消和总超时。
- 默认腾讯行情与东方财富行情回退；可选新浪、BaoStock、ZZShare、Tushare、TickFlow、Fuyao。
- 腾讯外汇按需批量提供 USD/CNY、USD/HKD、HKD/CNY 及反向汇率；币对去重并复用 Registry 缓存，缺失行情返回 `partial/unavailable`。
- 沪深北 A 股行情、日 K、资料、最近 4 期有界财务三表（保留最新一期摘要并提供报告期覆盖）、主要股东、分红、资金流、新闻、公告 HTML/PDF 正文；ETF 净值/溢价/主要持仓和 A 股市场专题。
- 港美股代码解析、腾讯公司中英文名/模糊搜索、行情、日 K 与公司基础资料；港股可返回主营、简介、行业、网站、上市日期和股本，美股可返回行业、简介、网站、上市日期、股本及有限收入分部。资料接口未提供独立数据截至时间时将 `asOf` 标记为未知，`retrievedAt` 只表示本次获取时间。显式启用新浪时提供名称搜索回退，TickFlow 启用时补充跨市场行情。
- 证据结果始终携带来源、截至时间、获取时间、缓存状态与警告；缺失能力返回 `partial/unavailable`。数据源状态在首次真实上游请求前为 `unknown`，不会把“尚未探测”伪装成 `ready`；请求成功/失败后才进入对应健康状态。

### 量化实验

- SMA5/10/20/60、MACD、RSI、Bollinger、KDJ、CCI、Williams %R、OBV、ADX/+DI/-DI、波动率与量价指标。
- 趋势、均值回归、突破、动量、量价五策略 registry 和信号融合。
- 多维 Evaluator：趋势、动量、量价、风险、财务质量、完整度、时效、评级和置信度。
- SMA 交叉、五策略和融合策略回测；默认以前 70% 数据校准/预热、后 30% 数据做样本外评估（可在 10%–80% 范围调整），信号只使用当前及更早数据并在下一根 K 线开盘执行。
- 回测收益、基准、回撤、交易与权益曲线只统计样本外区间，包含逐笔信号/执行时间、费用假设、分区覆盖率、缺口状态、算法版本与限制；覆盖不足返回 `partial/unavailable`。

### Calen 产品层

- 股票 Hub 五页：研究、市场、自选与持仓、实验室、数据源。
- `lightweight-charts` Calen 主题 K 线；研究页结构化展示财务三表、股东、分红、资金流、新闻、公告与 ETF 资料。
- Hub 的“AI 深度研究”会调用当前所选模型，模型只能读取带来源和时效的 sidecar 证据包，禁用工具与联网搜索，并分区输出可核验事实、支持论据、反面论据、风险和待验证事项；模型不可用或格式错误时保留 Provider 证据并明确报错。
- Hub 与对话股票结果卡展示顶层最早证据截至时间，并逐来源展示 Provider、能力和各自 `asOf`；技术指标、评分、策略、Evaluator 与回测单独标记为实验性，事实型研究不再整体标记实验性。
- 六个高层 AI 工具；Cron 只有研究/市场工具，子代理默认无股票工具。
- `StockPortfolioRead` 要求当前用户请求明确指向“我的/本地/这个组合”等本地资产。Gateway 远程来源在工具注册层禁用文件系统、Shell、终端、Memory、Skills、MCP、Cron、SSH、Tunnel、自定义系统工具和子代理，只保留不读取本地资产的五个股票研究工具与内存 Todo；即使误传资产授权也不会注册 `StockPortfolioRead`。实时事件、运行快照、历史投影以及组合工具后的模型复述/压缩摘要继续执行脱敏。
- 本地 SQLite 支持自选分组、多组合、买入、卖出、费用、分红、拆股、调整、删除回滚、CSV、CSV 导入批次审计记录和密码加密备份。
- Hub 已接通组合创建/切换、自选管理、手工流水、按组合 CSV、自动行情与自动汇率估值；手工带时间戳汇率按币对覆盖自动值，自动汇率失败只追加警告并保留原币分析。
- 市场页可一键创建工作日 08:30 盘前报告与 15:30 收盘复盘任务，复用当前模型和受限股票工具。
- `stock_portfolio` 已预留两个未联网的 Rust 领域 seam：券商 adapter 只能读取标准化流水供用户显式导入，不能下单或直接改账本；Gateway adapter 只能推拉端到端加密 envelope，明文资产、券商凭据和同步密钥均不进入普通设置或 Gateway 接口。

### Windows 生命周期与发布

- Windows x64 only Release workflow；构建 NSIS Setup.exe、MSI、各自 updater `.sig` 和 Windows-only `latest.json`。
- 安装包携带固定为 Node 24.17.0 x64 的运行时、sidecar bundle、NOTICE 和许可证，不包含 `node_modules`。启动入口会把 Node-facing 的 `\\?\C:\...` 与 `\\?\UNC\...` 归一化为普通路径，拒绝 Windows 设备命名空间；开发 override 会在启动前校验入口和显式 Node 文件。
- bundle verifier 在中文/空格路径和空 `PATH` 下直接运行 sidecar。
- Tauri updater 私钥和匹配公钥是强制门禁；仅当私钥本身加密时才需要密码，未加密私钥允许密码为空。Provider 条款批准变量也是发布门禁。
- Windows sidecar 使用 Job Object 进程树清理；更新、重启、退出均先停止 sidecar。

## 已知限制与发布边界

- 北交所当前 `920xxx` 代码已接入与沪深相同的东方财富个股深研路径；历史 `4/8` 开头旧代码仍按 BSE 识别，但代码切换关系不做静态猜测，旧代码失效时会返回 `partial/unavailable`，应按公司名称重新解析当前代码。市场专题仍是 A 股聚合视图，现有涨幅榜筛选器不宣称包含完整北交所分项。
- 港美股名称搜索依赖腾讯 smartbox；新浪可选回退的美股 suggestion 不提供可靠交易所和股票/ETF 分类，因此返回 `exchange=US`、`assetType=unknown` 与 `partial` 警告。离线时仍只能解析明确代码/ticker。
- 东方财富财务三表当前最多展示最近 4 个标准化报告期，不等同于完整财务数据库或长期数据湖。
- Sina、BaoStock 和所有 Key Provider 因独立条款尚未审批而默认关闭；这与原计划“默认使用全部免费源”存在合规驱动的有意偏差。
- 券商导入和端到端加密资产同步目前仅有领域端口与类型，尚无真实券商、密钥管理或 Gateway transport adapter，也未开放 Tauri 命令。
- GitHub Actions 已配置 updater 私钥、公钥和密码；项目维护者于 2026-07-16 确认首版默认 Provider 的正式合规批准，并授权设置 `CALEN_STOCK_PROVIDER_TERMS_APPROVED=true`。可选 Provider 仍受各自条款和用户授权约束。
- CI Run `29489190079` 已使用临时 updater 密钥完成真实 MSI/NSIS 构建、签名验证、中文/空格路径新装、旧版升级、sidecar 启动和卸载验收；正式 Release workflow 会使用生产密钥和上一公开版本再次执行同一生命周期验收。

## 当前自动化验证

- Sidecar：123 项测试，覆盖回退、缓存、Provider 级节流、按能力/市场隔离的健康状态、单 Provider 尝试与整单截止时间分离、403/429、离线、取消、自动汇率、ETF 溢价、公告 PDF、市场报告会话/交易日、港美公司资料、缺失字段与时效语义、低样本降级、量化确定性、时间切分与防未来函数。
- GUI 股票/结果卡：资产授权、Gateway 脱敏、五页 Hub、Tauri adapter、组合工作区、结构化研究和结果卡测试。
- Gateway 资产隐私回归覆盖工具执行前的原始用户文本、附件元数据、标题、事件流、运行快照和历史读取；明确的本地持仓轮次从首条用户消息起即只向 Gateway 投影隐私占位。
- Windows CI：bundle 隔离验证、Tauri backend check、股票 Rust 测试，以及使用临时 updater 密钥构建两个版本的 MSI/NSIS，在中文与空格路径执行安装、sidecar 启动、升级和卸载 smoke；已暂存资源还会经 `crates/stock-sidecar-runtime` 的生产命令路径连续执行两次 Node/entry stdio 请求，而非在测试中重新拼装或只直启 `node.exe`。Release 在打包前运行同一 runtime smoke；完整 Manager 策略由 Linux Tauri 测试覆盖，临时安装器不上传。portfolio 测试使用独立 `crates/stock-portfolio-core-tests` harness，复用桌面端同一组 Rust ledger 源文件但不加载 Tauri/WebView2 DLL。
- 实验室可独立运行技术指标、评分卡、策略信号和 Evaluator；GUI 保留结构化量化数据并提供原始实验数据折叠查看，回测仍独立展示时间切分结果。
- 市场页保留并展示涨跌停、热门板块、资金流、龙虎榜、异动和情绪分项的真实条目；缺失分项继续显示 `partial/unavailable`，不再用摘要数量替代明细。
- 数据源页增加 A 股、港股、美股和 ETF 能力矩阵，并显示 Provider 最近成功请求时间；未探测 Provider 仍明确显示 `unknown/待探测`。
- 发布 workflow 先生成 manifest、创建 draft Release、清理旧非 Windows 资产、上传四个安装器/签名和 `latest.json`，全部成功后才将 Release 公开。
- 发布 workflow 的安装器生命周期 smoke 只会在满足合规和签名门禁的正式 Windows 构建中执行。

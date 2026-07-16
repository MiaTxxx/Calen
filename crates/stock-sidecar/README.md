# Calen Stock Sidecar

Calen 的只读股票研究 sidecar。运行时仅依赖 Node.js 24，不启动 HTTP 服务，不使用 DuckDB、SQLite、Fastify 或 Opptrix workspace。

## 协议

构建后入口为 `dist/stdio.mjs`。标准输入和标准输出均为 UTF-8、每行一个 JSON-RPC 2.0 对象；诊断信息不得写入 stdout。

固定方法：

- `resolve`：解析 CN/HK/US 标的；代码可离线解析，名称搜索使用免费 Provider。
- `fxRates`：按需批量获取 CNY/HKD/USD 币对；支持 USD/CNY、USD/HKD、HKD/CNY 及反向，结果逐项携带行情时间，缺失值不会被推算。
- `snapshot`：获取归一化行情快照；`includeHistory=true` 时在 `data.chart.bars` 返回最多 120 根 K 线，并可合并 `data.profile` 与 `data.metrics`。
- `research`：`capabilities` 是实际交付清单；结果在 `data.capabilities[能力]` 中逐项返回 `status/data/warnings`，支持公司资料、财务三表、股东、分红、资金流、新闻、公告、ETF、技术指标、评分、策略和 Evaluator。东方财富财务三表按报告期对齐并严格限制为最近 4 期，同时保留 `statements` 最新一期摘要和 `coverage` 覆盖信息。可选 `strategyIds`：`trend`、`mean-reversion`、`breakout`、`momentum`、`volume-price`。
- `marketBrief`：接受 `session=pre_market|intraday|close|general`、可选 `tradeDate=YYYY-MM-DD` 和 `sections` 分项选择；结果在 `data.session`、`data.tradeDate`、`data.requestedSections` 与 `data.sections` 中回显请求语义。盘前、盘中、收盘使用不同默认查询计划；历史交易日仅查询 Provider 明确支持的日期分项，实时分项会返回 `partial` 与警告，不会用今天的数据冒充历史日期。分项包括 `movers`、`limitUp`、`limitDown`、`hotSectors`、`moneyFlow`、`dragonTiger`、`unusualMoves` 和带算法版本的派生 `sentiment`。
- `backtest`：运行有界 SMA 交叉或策略注册表回测（趋势、均值回归、突破、动量、量价、`fused`）；信号在收盘形成，只在下一根 K 线开盘执行。
- `status`：返回服务状态、Provider 能力、熔断和冷却信息。

所有数据结果都包含 `status`、`sources`、`asOf`、`retrievedAt`、`cached` 和 `warnings`；`status` 仅为 `ok | partial | unavailable`。任一请求能力缺失时不会返回 `ok`，也不会生成缺失事实。

## 公告正文与 PDF 边界

东方财富公告先通过 `np-anotice-stock.eastmoney.com/api/security/ann` 获取列表，再通过 `np-cnotice-stock.eastmoney.com/api/content/ann` 按 `art_code` 和 `page_index` 获取 JSONP 正文。正文接口提供 `notice_content` 和真实附件字段 `attach_url_web`；sidecar 会合并分页正文，并仅使用该真实附件地址作为 PDF 回退，不再根据公告编号派生 PDF URL。为限制网络与解析开销，每次研究仅富化前 3 条公告，其余条目保留标题、时间和详情页。

当正文接口没有可用文本时，sidecar 使用内联在 `unpdf@1.6.2` 中的 PDF.js 5.6.205 解析附件。单个 PDF 最大 25 MiB，最多解析 200 页并保留 100000 个字符；超过边界会截断或拒绝解析，并通过 `warnings` 和 `partial` 状态明确呈现。扫描件、加密文件、损坏文件以及依赖未随 bundle 分发的旧式 CMap 字体映射的 PDF 可能无法提取正文；此时保留公告列表、详情页和真实附件来源，不推测或补造缺失文本。

## Provider 能力与启用条件

启动时读取 `CALEN_STOCK_SETTINGS` 和 `CALEN_STOCK_PROVIDER_KEYS`。只有已经实现、被用户显式启用且满足凭据条件的 Provider 才会注册；状态使用 `disabled/unconfigured/unknown/ready/cooldown/unavailable` 区分禁用、缺少必要 Key、尚未完成首个真实上游探测、最近请求成功、冷却和失败。新启动的 Provider 不再未经请求就显示 `ready`。

| Provider            | 当前能力                                                                       | 鉴权条件                                                       | 默认状态                                     |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------- |
| 腾讯行情            | CN/HK/US 名称/代码模糊搜索、快照与日 K；港美公司基础资料；CNY/HKD/USD 外汇换算 | 无用户 Key                                                     | 开发默认启用；公开 Release 仍受合规门禁阻断  |
| 东方财富            | 标的搜索、日 K、公司资料、财务、股东、分红、资金流、新闻、公告、ETF 与市场专题 | 无用户 Key；网页固定参数不是用户凭据                           | 开发默认启用；公开 Release 仍受合规门禁阻断  |
| 新浪财经            | CN/HK/US 标的搜索；A 股快照与日 K                                              | 无用户 Key                                                     | 默认禁用，需用户显式启用                     |
| BaoStock            | 上交所/深交所 A 股日 K，以及由最近日 K 构造的延迟快照                          | 内置匿名 TCP 登录，无用户 Key                                  | 默认禁用，需用户显式启用                     |
| Tushare             | A 股标的搜索、日线快照、日 K、公司资料                                         | 必须配置 Token                                                 | 默认禁用；启用但无 Token 时为 `unconfigured` |
| TickFlow            | CN/HK/US 快照与日 K                                                            | 必须配置 API Key                                               | 默认禁用；启用但无 Key 时为 `unconfigured`   |
| ZZShare             | A 股标的搜索、日线收盘快照、日 K、公司资料                                     | 未配置 Key 时使用服务定义的 `sdk-key: anonymous`；也可选填 Key | 默认禁用，需用户显式启用                     |
| Fuyao（同花顺扶摇） | A 股标的搜索、快照、日 K                                                       | 必须配置 API Key，使用 `X-api-key` 与固定 Referer              | 默认禁用；启用但无 Key 时为 `unconfigured`   |

Provider Key 只注入对应请求并驻留 sidecar 进程内存，不进入 URL、Provider 状态、日志或 Gateway。错误消息会避免回显配置的 Key。上述六个可选 Provider 虽已完成本地工程验证，但其服务条款、缓存、再分发、商业使用和地域限制尚未获得批准；实现存在不等于允许随公开安装包启用或传播数据。

## 开发

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm verify:bundle
node dist/stdio.mjs
```

`pnpm build` 生成自包含的 `dist/stdio.mjs`，并将 `NOTICE.md`、unpdf MIT、PDF.js Apache-2.0 与 Opptrix Apache-2.0 许可证复制到 `dist/`。运行时无需安装 npm 依赖；Windows 安装包仍需同时携带 Node.js 24 x64 运行时。

默认免费数据源仍只有腾讯行情与东方财富。腾讯 smartbox 支持港美股公司中文名、英文名和代码模糊搜索，并按市场提示过滤；港美公司资料端点提供行业、简介、主营、网站、上市日期、股本等有限字段，端点不提供独立数据截至时间时将 `asOf` 标记为未知，`retrievedAt` 只表示获取时间。显式启用新浪后，其 suggestion 可作为 CN/HK/US 搜索回退。新浪美股结果不提供可靠交易所和股票/ETF 分类，因此统一返回 `exchange=US`、`assetType=unknown` 并标记 `partial`；其余港美深度能力仍可能返回 `partial/unavailable`。sidecar 会以 GB18030/GBK 解码新浪公开搜索和行情响应；新浪日 K 会明确提示接口未单独标注复权口径。BaoStock 快照、Tushare 与 ZZShare 的日线快照均不是实时行情，会在结果中标注数据口径或延迟。所有 Provider 都通过同一 Registry 执行超时、缓存、回退和健康熔断；免费源的 403/429/5xx 还会触发阶梯冷却，缺失能力只会降级为 `partial/unavailable`。

技术指标、策略融合、质量维度与 Evaluator、回测均为实验性研究工具；结果不代表任何真实机构观点，不构成投资建议，也不提供交易或下单能力。量化实现来源与修改说明见 `NOTICE.md` 的“量化研究来源与修改说明”。

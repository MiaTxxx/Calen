# Third-party notice

本模块的跨市场标的、Provider Registry、能力路由、缓存、免费数据源冷却和证据元数据设计参考了以下来源工程：

- Opptrix，Apache License 2.0
- 上游作者：Opptrix contributors
- 上游项目主页：<https://www.opptrix.org>
- 上游源代码：<https://github.com/Travisun/Opptrix>
- 来源目录：`Opptrix-main/packages/a-stock-layer`、`Opptrix-main/packages/research-hub`、`Opptrix-main/packages/stock-eval`、`Opptrix-main/packages/t-strategy`、`Opptrix-main/packages/institutions`
- 上游许可证：`Opptrix-main/LICENSE`

Calen 没有逐文件照搬 Opptrix 的产品层；所有适配器均面向独立 JSON-RPC sidecar 和稳定 `StockProvider` 接口进行精简实现，没有引入 Opptrix 的 Electron、Fastify、React UI、DuckDB、better-sqlite3 或完整 ToolRegistry。BaoStock、Fuyao 和量化研究模块明确使用了上游协议、端点或算法结构并进行了精简重写/修改，因此按 Apache-2.0 来源适配记录如下。分发包含这些适配实现时，必须同时保留本 NOTICE 和 `dist/licenses/opptrix-Apache-2.0.txt`。

## Provider 适配来源与修改说明

| Opptrix 来源                                                                                                       | Calen 文件                     | 使用与修改说明                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Opptrix-main/packages/a-stock-layer/src/providers/tencent/api/proxy.ts`、`normalize/market.ts`                    | `src/providers/tencent.ts`     | 参考腾讯 smartbox 搜索端点与跨市场 symbol 形态，按 Calen `InstrumentRef` 精简重写 CN/HK/US 名称搜索、市场过滤、产品类型白名单和能力限制警告；未复制上游 HTTP 客户端。                         |
| `Opptrix-main/packages/a-stock-layer/src/providers/tencent/api/hk-detail-service.ts`、`us-detail-service.ts`       | `src/providers/tencent.ts`     | 参考腾讯港股 `hkStockinfo/jiankuang` 与美股 `us/introduce/brief` 端点及字段位置，独立精简重写公司名称、行业、简介、业务、网站、上市日期和股本字段映射；未复制上游 HTTP 客户端或完整详情能力。 |
| `Opptrix-main/packages/a-stock-layer/src/providers/tencent/api/exchange-rate-service.ts`                           | `src/providers/tencent-fx.ts`  | 参考腾讯 `wh*` 外汇批量行情端点与字段位置，按 Calen 证据接口精简重写 USD/CNY、USD/HKD、HKD/CNY 及反向换算；新增币对去重、时间戳归一化、缺失警告、缓存/限流接入，未复制上游 HTTP 客户端。      |
| `Opptrix-main/packages/a-stock-layer/src/providers/sinafinance`                                                    | `src/providers/sinafinance.ts` | 参考能力边界和公开页面入口，按 `StockProvider` 独立实现 GB18030/GBK 解码、搜索、快照与日 K；未复制上游 Handler 或 HTTP 客户端。                                                               |
| `Opptrix-main/packages/a-stock-layer/src/providers/baostock/api`、`normalize/klines.ts`、`normalize/quotes.ts`     | `src/providers/baostock.ts`    | **精简重写/修改** BaoStock TCP wire、匿名登录、压缩日 K 响应和字段归一化；改为纯 Node `net`、`AbortSignal`、有界分页和 Calen 证据接口，仅保留快照与日 K。文件头保留了 adapted 来源说明。      |
| `Opptrix-main/packages/a-stock-layer/src/providers/tushare`                                                        | `src/providers/tushare.ts`     | 参考 Tushare 请求和 A 股字段映射，精简为搜索、日线快照、日 K 与公司资料；凭据仅在请求体中使用，错误和状态不输出 Token。                                                                       |
| `Opptrix-main/packages/a-stock-layer/src/providers/tickflow`                                                       | `src/providers/tickflow.ts`    | 参考 TickFlow OpenAPI 路径和紧凑 K 线结构，精简为 CN/HK/US 快照与日 K；API Key 仅进入请求头。                                                                                                 |
| `Opptrix-main/packages/a-stock-layer/src/providers/zzshare`                                                        | `src/providers/zzshare.ts`     | 参考 ZZShare v3 接口和字段口径，精简为 A 股搜索、日线快照、日 K 与公司资料；支持服务定义的 `sdk-key: anonymous` 和可选用户 Key。                                                              |
| `Opptrix-main/packages/a-stock-layer/src/providers/tonghuashun/api`、`normalize/index.ts`、`markets/cn/handler.ts` | `src/providers/fuyao.ts`       | **精简重写/修改** Fuyao 端点、`thscode`、快照和历史 DTO 映射；改为 Calen fetch Provider，仅保留 A 股搜索、快照与日 K，并新增 Key 脱敏、超时/取消和证据元数据。文件头保留了 adapted 来源说明。 |

## 量化研究来源与修改说明

| Opptrix 来源                                                         | Calen 文件                                   | 使用与修改说明                                                                                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Opptrix-main/packages/t-strategy/src/indicators.ts`                 | `src/quant/indicators.ts`                    | **精简重写/修改** 均线、MACD、Bollinger、KDJ、Williams %R、CCI、OBV、ADX 与量价指标；改为严格 `PriceBar` 输入、`undefined` 缺失值和仅使用当根及更早数据的因果计算。                |
| `Opptrix-main/packages/t-strategy/src/strategies.ts`                 | `src/quant/strategies.ts`、`src/backtest.ts` | **精简重写/修改** 策略注册表与信号融合结构；Calen 使用趋势、均值回归、区间突破、动量和量价确认五类透明规则，删除机构名义、仓位建议和自动交易语义，并统一下一根开盘执行的回测边界。 |
| `Opptrix-main/packages/institutions/src/evaluator.ts`、`registry.ts` | `src/quant/evaluator.ts`、`src/analytics.ts` | **精简重写/修改** 数据完整度、时效与多维加权评级；Calen 不声称代表任何真实机构观点，只输出透明维度、质量、算法版本、参数和实验性免责声明。                                         |

上述来源目录来自用户提供的本地 Opptrix 快照；该目录没有独立 Git 元数据，无法可靠列出上游提交号。若后续引入新的逐字复制或实质改编文件，必须继续补充“上游路径 → Calen 文件”、版权头和具体修改说明。

腾讯标的搜索使用 `proxy.finance.qq.com/cgi/cgi-bin/smartbox/search`，外汇换算使用 `qt.gtimg.cn` 的 `wh*` 批量行情。新浪标的搜索使用 `suggest3.sinajs.cn`，快照使用 `hq.sinajs.cn`，日 K 使用 `CN_MarketData.getKLineData`。这些接口以及 BaoStock、Tushare、TickFlow、ZZShare 和 Fuyao 服务均受各自数据条款约束；开源代码许可证不构成数据访问、缓存、再分发或商业使用授权。六个可选 Provider 在独立条款审批完成前均默认禁用。

## PDF 文本抽取

公告 PDF 文本抽取使用以下随 sidecar bundle 分发的第三方软件：

- unpdf 1.6.2，Copyright (c) 2023-PRESENT Johann Schopplich，MIT License，<https://github.com/unjs/unpdf>
- PDF.js 5.6.205，Mozilla contributors，Apache License 2.0，<https://github.com/mozilla/pdf.js>

unpdf 的发布产物内联了 PDF.js 5.6.205；Calen 再将该产物打入自包含的 `dist/stdio.mjs`，因此运行时不会加载独立的 `unpdf` 或 `pdfjs-dist` 包。完整许可证分别位于 `licenses/unpdf-MIT.txt` 与 `licenses/pdfjs-Apache-2.0.txt`，构建时会连同本 NOTICE 复制到 `dist/`。

东方财富公告列表来自 `https://np-anotice-stock.eastmoney.com/api/security/ann`，正文与真实附件地址来自 `https://np-cnotice-stock.eastmoney.com/api/content/ann` 的 `notice_content` 与 `attach_url_web` 字段。单个附件限制为 25 MiB、200 页和 100000 个提取字符。旧式 CMap、扫描件、加密或损坏 PDF 可能只返回 `partial` 证据；Calen 会保留来源与警告，不补造正文。市场数据接口和公告内容仍受数据站点自身条款约束，开源软件许可证不构成数据授权。

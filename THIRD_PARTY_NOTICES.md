# Third-Party Notices

## llama.cpp 与可选离线翻译模型

Calen Windows 安装包携带 llama.cpp 的固定 CPU x64 运行时，用于执行用户明确下载或导入的本地 GGUF 翻译模型。

- 上游项目：llama.cpp
- 上游地址：https://github.com/ggml-org/llama.cpp
- 固定版本：b10066
- 固定提交：`86a9c79f866799eb0e7e89c03578ccfbcc5d808e`
- 上游许可证：MIT License
- Calen 资源目录：`crates/agent-gui/src-tauri/resources/translation-runtime`
- 构建方式：Release CI 从固定源码构建 OpenMP-free、静态项目库与静态 MSVC runtime 的 `llama-server.exe`

Calen 不复用上游 Windows CPU ZIP 中从 Visual Studio `debug_nonredist` 目录复制的 `libomp140.x86_64.dll`，也不随安装包分发该 DLL。生成的 `runtime-manifest.json` 记录固定提交、构建约束和最终二进制 SHA-256。

安装包不包含模型权重。模型只有在用户于应用内明确选择下载或导入后才会写入本机应用数据目录。Qwen3-0.6B-GGUF Q8_0 由 Qwen Team 以 Apache License 2.0 发布，继续作为兼容现有安装和 HY-MT 许可不适用地区的兜底选项。用户自行导入的其他 GGUF 不视为 Calen 分发内容，用户负责确认该文件的使用授权。

### HY-MT1.5 应用内下载与许可门禁

Tioms 已确认取得将 HY-MT1.5 作为 Calen 应用内下载项的合规批准。该确认不替代、修改或扩张 Tencent HY Community License Agreement 授予的权利；Calen 仅在许可允许的 Territory 内向明确接受许可的用户开放下载。Q4_K_M 为默认推荐项，Q8_0 为可选高质量项：

| 变体                        | Hugging Face revision                      | ModelScope revision                        |            精确大小 | SHA-256                                                            |
| --------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------: | ------------------------------------------------------------------ |
| `HY-MT1.5-1.8B-Q4_K_M.gguf` | `265b2e615a7dc9b06c435dc878829ad99a512ba2` | `acac2122e32c8d7e6221fb135f918f6e6c87ce49` | 1,133,080,512 bytes | `4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7` |
| `HY-MT1.5-1.8B-Q8_0.gguf`   | `265b2e615a7dc9b06c435dc878829ad99a512ba2` | `acac2122e32c8d7e6221fb135f918f6e6c87ce49` | 1,908,528,288 bytes | `6789b06d0902f2f5312c0e1703d56ccbddfcfb6c653d22519b7c720f7db9a98e` |

- 上游模型：https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF
- 许可证：Tencent HY Community License Agreement
- 固定许可原文：https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/blob/265b2e615a7dc9b06c435dc878829ad99a512ba2/License.txt
- 随安装资源提供的许可全文：`crates/agent-gui/src-tauri/resources/translation-runtime/licenses/Tencent-HY-Community-License.txt`
- 第 3(d) 节要求的 Notice：`crates/agent-gui/src-tauri/resources/translation-runtime/licenses/Tencent-HY-NOTICE.txt`

该许可的 Territory 明确排除欧盟、英国和韩国。在这些地区，对 Tencent HY Works 或其输出的使用、复现、修改、分发或展示均不在许可授权范围内；Calen 必须禁用 HY-MT 下载和使用，并保留 Qwen 或远程 Provider 选项。下载前还必须展示固定 revision 与 SHA-256，并要求用户接受完整许可及其 Acceptable Use Policy、确认地域资格；本地确认 receipt 与 model ID、许可 revision 绑定，使用内置 HY-MT 前会重新校验。若许可中规定的 1 亿月活跃用户阈值适用，Tioms 必须先取得 Tencent 另行授予的许可。

Calen 及其 HY-MT 离线翻译功能的实际提供者完整法定名称为 **Tioms**。Tencent 与 Tioms 或 Calen 无关联、无合作关系，不赞助也不为 Calen、其功能或输出背书。Calen 不以任何名称、标识或商标制造与 Tencent 存在关联、赞助或背书关系的误解。

## Opptrix

Calen 的股票研究模块参考并可能包含源自 Opptrix 的代码或经修改的实现。

- 上游项目：Opptrix
- 上游地址：https://github.com/Travisun/Opptrix
- 项目主页：https://www.opptrix.org
- 上游版权：Copyright © 2026 Opptrix contributors
- 来源目录：`Opptrix-main/`
- 来源版本：用户提供的本地源码快照；该目录不含独立 Git 元数据，无法可靠恢复上游提交号
- 上游许可证：Apache License 2.0
- 参考模块：`packages/a-stock-layer`、`packages/research-hub`、`packages/agent`、`packages/stock-eval`、`packages/t-strategy`、`packages/institutions`
- Calen 中的目标模块：`crates/stock-sidecar`

本轮实现参考了上述模块的领域边界、Provider Registry、公告正文和研究工具设计。`crates/stock-sidecar` 没有复制 Opptrix 的 Electron、Fastify、React UI、DuckDB 或完整工具注册表；Provider 均收敛为 Calen 稳定接口。以下文件使用了 Opptrix Provider 的协议、端点或 DTO 思路并进行了独立精简实现，其中 BaoStock 与 Fuyao 在源文件头中明确标记为 adapted：

| Opptrix 上游目录                                                                                      | Calen 目标文件                                        | 适配和修改                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/a-stock-layer/src/providers/tencent/api/proxy.ts`、`normalize/market.ts`                    | `crates/stock-sidecar/src/providers/tencent.ts`       | 参考腾讯 smartbox 搜索端点与跨市场 symbol 形态，按 Calen `InstrumentRef` 独立精简重写 CN/HK/US 名称搜索、市场过滤、产品类型白名单和能力限制警告。 |
| `packages/a-stock-layer/src/providers/tencent/api/hk-detail-service.ts`、`us-detail-service.ts`       | `crates/stock-sidecar/src/providers/tencent.ts`       | 参考腾讯港美股公司资料端点及字段位置，独立精简重写公司名称、行业、简介、主营、网站、上市日期和股本字段映射，不迁移完整详情服务。                  |
| `packages/a-stock-layer/src/providers/tencent/api/exchange-rate-service.ts`                           | `crates/stock-sidecar/src/providers/tencent-fx.ts`    | 参考腾讯 `wh*` 外汇批量行情端点与字段位置，按 Calen 证据接口独立精简重写受支持币对与反向换算，并接入去重、缓存、限流和缺失警告。                  |
| `packages/a-stock-layer/src/providers/sinafinance`                                                    | `crates/stock-sidecar/src/providers/sinafinance.ts`   | 参考能力边界和页面入口，独立重写编码处理、搜索、快照与日 K。                                                                                      |
| `packages/a-stock-layer/src/providers/baostock/api`、`normalize/klines.ts`、`normalize/quotes.ts`     | `crates/stock-sidecar/src/providers/baostock.ts`      | **精简重写/修改** TCP wire、匿名登录、压缩响应和 K 线归一化；改为 Node `net`、取消信号、有界查询和 Calen 证据结果。                               |
| `packages/a-stock-layer/src/providers/tushare`                                                        | `crates/stock-sidecar/src/providers/tushare.ts`       | 精简为 A 股搜索、日线快照、日 K、公司资料和最小 Token 注入。                                                                                      |
| `packages/a-stock-layer/src/providers/tickflow`                                                       | `crates/stock-sidecar/src/providers/tickflow.ts`      | 精简为 CN/HK/US 快照、日 K 和请求头 Key 注入。                                                                                                    |
| `packages/a-stock-layer/src/providers/zzshare`                                                        | `crates/stock-sidecar/src/providers/zzshare.ts`       | 精简为 A 股搜索、日线快照、日 K、公司资料及 `anonymous`/可选 Key。                                                                                |
| `packages/a-stock-layer/src/providers/tonghuashun/api`、`normalize/index.ts`、`markets/cn/handler.ts` | `crates/stock-sidecar/src/providers/fuyao.ts`         | **精简重写/修改** Fuyao 端点、`thscode` 和行情 DTO；仅保留 A 股搜索、快照、日 K，并增加 Key 脱敏与证据元数据。                                    |
| `packages/t-strategy/src/indicators.ts`、`strategies.ts`                                              | `crates/stock-sidecar/src/quant/*`、`src/backtest.ts` | **精简重写/修改** 因果技术指标、五策略 registry、信号融合和下一根开盘执行的研究回测；删除仓位与自动交易语义。                                     |
| `packages/institutions/src/evaluator.ts`、`registry.ts`                                               | `crates/stock-sidecar/src/quant/evaluator.ts`         | **精简重写/修改** 为透明的多维数据质量与研究评级；不使用真实机构名义，不声称代表机构观点。                                                        |

用户提供的 `Opptrix-main/` 不含独立 Git 元数据，因此无法可靠恢复上游提交号。分发上述适配实现时必须保留文件中的来源说明、本 NOTICE，并提供 `crates/stock-sidecar/dist/licenses/opptrix-Apache-2.0.txt`；本文件不能替代许可证原文。若后续引入新的逐字复制或实质改编文件，必须继续追加“上游文件 → Calen 文件”、版权头和具体修改说明。

## unpdf 与 PDF.js

Calen 股票 sidecar 的公告 PDF 文本抽取包含以下开源组件：

- unpdf 1.6.2，Copyright (c) 2023-PRESENT Johann Schopplich，MIT License，<https://github.com/unjs/unpdf>
- PDF.js 5.6.205，Mozilla contributors，Apache License 2.0，<https://github.com/mozilla/pdf.js>

unpdf 1.6.2 的发布产物已内联 PDF.js 5.6.205，Calen 将其继续打入 `crates/stock-sidecar/dist/stdio.mjs`。Windows 分发物必须同时携带 `crates/stock-sidecar/NOTICE.md`、`crates/stock-sidecar/licenses/opptrix-Apache-2.0.txt`、`crates/stock-sidecar/licenses/unpdf-MIT.txt` 和 `crates/stock-sidecar/licenses/pdfjs-Apache-2.0.txt`；构建脚本会把这些文件复制到 sidecar 的 `dist/` 目录。

东方财富公告正文通过 `np-cnotice-stock.eastmoney.com/api/content/ann` 获取，附件只采用接口返回的真实 `attach_url_web`。PDF 解析边界为 25 MiB、200 页、100000 字符；旧式 CMap 等无法完整解析的情况会以 `partial` 和警告呈现。上述软件许可证仅覆盖代码，不授予东方财富或其他数据站点内容的抓取、再分发或商业使用权。

目前的架构术语、代码许可证和本地工程验证均不代表外部市场数据授权。腾讯与东方财富的首版工程/产品约束记录见 `docs/provider-compliance-review.md`；公开 Release 仍要求正式授权或合规批准。新浪、BaoStock、Tushare、ZZShare、TickFlow、Fuyao 分别受其自身服务条款、配额、缓存、再分发、商业使用和地域限制约束，当前均未取得条款审批，因此保持默认禁用；配置 Key 或使用服务定义的匿名身份也不会自动产生数据使用权。

Calen 展示的市场信息可能延迟、不完整或错误，仅供研究与信息参考，不构成投资建议、交易邀约或收益保证。

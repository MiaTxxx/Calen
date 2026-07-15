# Calen Stock Sidecar

Calen 的只读股票研究 sidecar。运行时仅依赖 Node.js 24，不启动 HTTP 服务，不使用 DuckDB、SQLite、Fastify 或 Opptrix workspace。

## 协议

构建后入口为 `dist/stdio.mjs`。标准输入和标准输出均为 UTF-8、每行一个 JSON-RPC 2.0 对象；诊断信息不得写入 stdout。

固定方法：

- `resolve`：解析 CN/HK/US 标的；代码可离线解析，名称搜索使用免费 Provider。
- `snapshot`：获取归一化行情快照；`includeHistory=true` 时在 `data.chart.bars` 返回最多 120 根 K 线，并可合并 `data.profile` 与 `data.metrics`。
- `research`：`capabilities` 是实际交付清单；结果在 `data.capabilities[能力]` 中逐项返回 `status/data/warnings`，支持公司资料、财务三表、股东、分红、资金流、新闻、公告、ETF、技术指标、评分、策略和 Evaluator。
- `marketBrief`：在 `data.sections` 返回 `limitUp`、`limitDown`、`hotSectors`、`moneyFlow`、`dragonTiger`、`unusualMoves` 和带算法版本的派生 `sentiment`。
- `backtest`：运行有界 SMA 交叉回测；信号在收盘形成，只在下一根 K 线开盘执行。
- `status`：返回服务状态、Provider 能力、熔断和冷却信息。

所有数据结果都包含 `status`、`sources`、`asOf`、`retrievedAt`、`cached` 和 `warnings`；`status` 仅为 `ok | partial | unavailable`。任一请求能力缺失时不会返回 `ok`，也不会生成缺失事实。公告会尝试抽取前 3 条 HTML 正文；未抽取成功的条目仅返回页面、派生 PDF URL 和标题摘要。PDF 文本抽取尚不可用并会显式警告。

启动时读取 `CALEN_STOCK_SETTINGS` 和 `CALEN_STOCK_PROVIDER_KEYS`。只有当前真实实现且启用的 Provider 会注册；新浪、BaoStock 和 Key Provider 在实现前只会显示为 `disabled/unconfigured`，Key 仅驻留内存且不会输出到状态或日志。

## 开发

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm build
node dist/stdio.mjs
```

默认免费数据源为腾讯行情与东方财富，均不需要 API Key。东方财富接口属于网页内部公开接口、没有 SLA；Provider Registry 会执行超时、缓存、回退、健康熔断和阶梯冷却，缺失章节会降级呈现。

回测及评分均为实验性研究工具，不构成投资建议，也不提供交易或下单能力。

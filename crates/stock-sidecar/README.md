# Calen Stock Sidecar

Calen 的只读股票研究 sidecar。运行时仅依赖 Node.js 24，不启动 HTTP 服务，不使用 DuckDB、SQLite、Fastify 或 Opptrix workspace。

## 协议

构建后入口为 `dist/stdio.mjs`。标准输入和标准输出均为 UTF-8、每行一个 JSON-RPC 2.0 对象；诊断信息不得写入 stdout。

固定方法：

- `resolve`：解析 CN/HK/US 标的；代码可离线解析，名称搜索使用免费 Provider。
- `snapshot`：获取归一化行情快照。
- `research`：组合快照、有限 K 线、技术指标、版本化评分和规则 Evaluator。
- `marketBrief`：按需获取市场异动概览。
- `backtest`：运行有界 SMA 交叉回测；信号在收盘形成，只在下一根 K 线开盘执行。
- `status`：返回服务状态、Provider 能力、熔断和冷却信息。

所有数据结果都包含 `status`、`sources`、`asOf`、`retrievedAt`、`cached` 和 `warnings`。Provider 全部失败时返回 `partial` 或 `unavailable`，不会生成缺失事实。

## 开发

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm build
node dist/stdio.mjs
```

默认免费数据源为腾讯行情与东方财富，均不需要 API Key。公共站点可能限流、拒绝访问或调整响应格式，因此 Provider Registry 会执行超时、缓存、回退、健康熔断和阶梯冷却。

回测及评分均为实验性研究工具，不构成投资建议，也不提供交易或下单能力。

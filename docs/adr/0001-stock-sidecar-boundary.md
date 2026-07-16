# ADR-0001：以受控 Node sidecar 承载股票领域能力

- 状态：接受
- 日期：2026-07-15

## 背景

Calen 是 Tauri 桌面 Agent，Opptrix 是包含 Electron、Web、Fastify、Agent 和多数据层包的完整产品。整体迁移会扩大安装体积、权限面和维护边界，并使 Calen UI 与 Provider 实现耦合。

## 决策

股票能力收敛为 `StockResearchPort` 深模块，由独立 Node 24 sidecar 实现。Tauri 通过 JSON-RPC stdio 管理进程、超时、取消、健康检查和最多一次自动重启；sidecar 不开放网络监听端口。

Windows 安装包携带 Node 24 x64 运行时和 sidecar 编译产物。Provider、缓存、限流、熔断、回退和数据归一化完全隐藏在接口之后。MCP 与 Builtin Tools 都只是 adapter，不能绕过该接口。

## 后果

- 用户无需安装 Node，运行环境可复现；代价是安装包增大。
- sidecar 可独立契约测试和替换；跨进程类型需保持向后兼容。
- API Key 由 Tauri 本地秘密存储注入，禁止进入 Gateway、普通设置同步和日志。
- 首版 Manager 为保证 stdio 响应匹配与取消语义，跨请求串行执行；单次研究内部可并行查询多个 Provider 能力。若后续需要高并发，再引入独立 reader task 与 request-id 多路复用。
- Windows sidecar 进程加入 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job Object；更新安装、应用重启和真实退出都会先停止 sidecar，避免 `node.exe` 锁定安装目录或遗留子进程。
- ZZShare、Tushare、TickFlow、Fuyao Key Provider 已实现，但仍默认关闭。保存的 Key 仅从 Windows Credential Manager 注入 sidecar，普通设置、Gateway 投影和日志只显示 `keyConfigured`。
- Provider Registry 同时具有请求前节流 seam 和响应后冷却/熔断；本地节流等待支持取消和总超时，且不会被误计为 Provider 上游失败。
- Gateway 发起的会话不注册资产读取工具；本地持仓分析即使镜像到 Gateway，也只发送隐私占位，资产明文仅保留在桌面本地 transcript 与 SQLite。
- 首版仅 Windows x64；其他平台必须分别解决运行时打包、路径和签名后再开放。

## 被拒绝方案

- 整体嵌入 Opptrix：产品层和依赖过重。
- 直接复制全部 MCP 工具：工具面过大，暴露 Provider 细节。
- 在 Tauri 内重写全部 Provider：首期成本高，失去 Opptrix 已验证的 TypeScript 实现。

## 来源

设计参考 Opptrix 的 `packages/a-stock-layer/src/engine.ts`、`packages/research-hub/src/hub.ts` 与 `packages/agent/src/mcp/stdio-entry.ts`。实际 Calen 代码的复制范围须在第三方声明中逐项登记。

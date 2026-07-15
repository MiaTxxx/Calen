# Calen 协作说明

## 项目定位

当前 Git 仓库根目录就是 Calen 主工程。Calen 基于上游 Local-first AI Agent 桌面项目演进，主技术栈为 Tauri 2、React、TypeScript、Rust、SQLite、Go、gRPC 与 WebSocket。

`Opptrix-main/` 是股票/投研能力的来源工程，默认只读；从中提取领域模块、Provider 设计或 MCP 能力后，实际产品代码应落在 Calen 主工程中。

## AI 处理任务时的规则

1. 默认修改仓库根目录下的 Calen 主工程；只在用户明确要求时直接修改 `Opptrix-main/`。
2. 股票能力优先通过现有 MCP seam 接入，再收敛为受控 sidecar；不要复制 Opptrix 的完整 Web/Electron/API 产品层。
3. 不要使用 `git add .` 或 `git add -A`，避免把整个 `Opptrix-main/` 来源目录误提交。只精确暂存 Calen 文件。
4. 引用 Opptrix 设计时给出具体路径，并区分“来源工程事实”和“Calen 适配方案”。
5. 复用代码前检查许可证：Calen 上游为 MIT，Opptrix 为 Apache-2.0；保留原版权和必要归属。
6. 股票结果必须标明来源、时效和不确定性；工具失败或数据缺失时不得编造。
7. 首版股票能力只读，不加入自动交易、下单、保证收益或投资建议。
8. API Key、用户数据、更新签名、远程服务和发布操作必须遵循最小权限与显式配置。

## 品牌与兼容标识

面向用户和发布渠道的产品名是 `Calen`，GitHub 仓库是 `MiaTxxx/Calen`。

第一轮品牌迁移刻意保留部分旧的内部兼容标识，例如 `.liveagent` 数据目录、`LIVEAGENT_*` 环境变量、`com.xiaofei.liveagent` 应用 identifier、gRPC package 和部分存储键。不要在没有数据迁移、升级路径和部署兼容方案时直接全局改名。

新增配置优先使用 `CALEN_*`；读取配置时可兼容旧 `LIVEAGENT_*` 名称。

## 修改通用 Agent 能力前的阅读顺序

1. `docs/architecture/overview.md`
2. `docs/features/chat-runtime.md`
3. `docs/features/tools.md`
4. `docs/features/skills-and-mcp.md`
5. `docs/architecture/protocols.md`

实现定位：

- 桌面 UI：`crates/agent-gui/src`
- Agent 和 Builtin Tools：`crates/agent-gui/src/lib/chat`、`crates/agent-gui/src/lib/tools`
- 高权限本地能力和持久化：`crates/agent-gui/src-tauri/src`
- 远程 Gateway：`crates/agent-gateway`
- 浏览器 WebUI：`crates/agent-gateway/web`

## 接入股票能力前的阅读顺序

先读 `docs/stock-integration-plan.md`，再按需阅读：

1. `Opptrix-main/packages/agent/src/mcp/stdio-entry.ts`
2. `Opptrix-main/packages/agent/src/mcp/server.ts`
3. `Opptrix-main/packages/agent/src/tools.ts`
4. `Opptrix-main/packages/research-hub/src/hub.ts`
5. `Opptrix-main/packages/a-stock-layer/src/engine.ts`
6. `Opptrix-main/docs/DATA-LAYER.md`
7. `Opptrix-main/docs/PROVIDER-STANDARD-API.md`

## 架构方向

- Calen 保持通用 Agent 主工程；股票能力作为独立领域模块进入。
- 长期 seam 是小而稳定的 `StockResearch` interface；MCP、stdio 和 Builtin Tool 都只是 adapter。
- interface 隐藏 Provider 路由、缓存、限流、来源、时效、错误和供应商数据格式。
- 开发验证期可以直接使用 Opptrix MCP；产品化时应收敛为 Calen 可管理、可测试、可打包的 sidecar。

## 交付前自检

- 用户可见品牌和 GitHub/Release 信息均为 Calen；
- 内部兼容标识没有被无迁移破坏；
- 目标改动落在 Calen，而非无意修改来源工程；
- 测试、类型检查、Rust/Go 检查与改动风险匹配；
- 未泄漏 API Key、用户数据或签名私钥；
- 直接复制的 Apache-2.0 代码已记录来源与归属。

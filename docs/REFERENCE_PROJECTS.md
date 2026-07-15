# 参考项目理解笔记

本文件记录 Calen 主工程的上游架构来源与股票来源工程。当前仓库根目录已经是 Calen 主工程；`Opptrix-main` 用于提取股票领域能力。来源工程的现有实现不代表 Calen 已经实现了其中任何功能。股票接入路线见 `docs/stock-integration-plan.md`。

## 1. Calen 主工程（上游 LiveAgent 架构）

### 定位

Calen 当前继承了上游 LiveAgent 的 Local-first AI Agent 桌面架构。桌面端可以独立运行，模型通过本地工具操作文件、Shell、长驻进程、MCP、Skills、记忆和定时任务；需要远程访问时，再部署 Go Gateway，由浏览器 WebUI 通过 Gateway 控制桌面端。

### 分层和真相源

| 层 | 路径 | 责任 |
|---|---|---|
| GUI | `crates/agent-gui/src` | Chat、Settings、Skills/MCP Hub、Memory UI、历史和流式渲染 |
| 本地后端 | `crates/agent-gui/src-tauri/src` | 文件/Shell/进程、SQLite、MCP runtime、MemoryStore、Cron、Gateway bridge |
| Agent runtime | `crates/agent-gui/src/lib/chat`、`src/pages/chat`、`src/lib/tools` | 上下文、模型流、工具循环、压缩、历史和 Gateway 事件 |
| Gateway | `crates/agent-gateway` | gRPC/HTTP/WebSocket 中继、认证、会话、有限事件窗口和静态 WebUI |
| Gateway WebUI | `crates/agent-gateway/web` | 浏览器侧 Chat/Settings/Hub，通过 Gateway 操作本地 Agent |

核心原则是桌面端为真相源：Gateway 不访问用户文件系统、不保存真实 Provider Key、不执行本地工具，只维护远程会话和有界事件中继。详见 `docs/architecture/overview.md` 和 `docs/architecture/protocols.md`。

### 一次对话的运行链

`ChatPage` 收集输入和附件 → 加载 Skills、Memory、Hooks、历史 → 按 `text`/`tools`/`agent-dev` 构造模型上下文 → 流式生成或进入工具循环 → 工具 Registry 执行本地/MCP 能力 → 写入历史、生成标题、触发记忆提取和 Hooks → 向 Gateway 发布可订阅事件。

长对话在发送前、流式过程中或工具调用后触发压缩；摘要以 checkpoint 写入新的 history segment。远程短时断线由 Gateway 的 seq window 补齐，Gateway 重启后再以桌面历史和运行账本对账。

### 适合作为参考的能力

- 高权限本地能力与远程网络层隔离。
- 工具 Registry、MCP、Skills 和 Hook 生命周期。
- 对话上下文压缩与可恢复历史。
- Memory 的 Markdown 事实源 + SQLite FTS 索引。
- 事件流、序列号、幂等和断线恢复。

### 不应直接照搬的前提

- Tauri/Rust/Go 的进程边界只适合需要桌面系统能力的产品。
- Gateway 的权限、安全和 token 设计必须结合 Calen 的部署模型重新设计。
- `agent-gui` 和 `gateway/web` 使用 Biome；不要因参考它而给当前根目录强行引入 Prettier。

## 2. Opptrix-main

### 定位

Opptrix 是面向个人投资者和研究者的全球多市场投研信息整理工具，不是券商、投顾或自动交易终端。用户通过自然语言提问，Agent 调用结构化投研工具，查询 A 股、美股、港股、日股、韩股和加密货币等市场，再生成带事实约束的中文分析。Web 与 Electron 共用 React UI 和 Fastify API。

### 分层和请求流

```text
client-ui (React/Vite)
  -> apps/server (Fastify REST/SSE/静态 SPA)
  -> packages/agent (AgentEngine + MCP)
  -> research-hub / search-hub
  -> a-stock-layer (MarketDataEngine + Provider Registry)
  -> CN/US/Crypto 等 Provider
```

关键职责：

- `packages/shared`：`InstrumentRef`、市场注册表、Tool Pack 等共享类型和常量。
- `packages/a-stock-layer`：统一的 `queryInstrumentData(ref, capability, opts?)`，按市场和 capability 选择 Provider 并故障回退。
- `packages/research-hub` / `packages/search-hub`：业务 feature 调度和标的搜索；HTTP 与 Agent 共用这些能力。
- `packages/agent`：OpenAI 兼容 Function Calling、MCP Broker、Tool Pack 路由、`ask_user` 交互和证据纪律。
- `packages/user-store` / `market-data-store`：SQLite 用户数据、缓存、Schema 迁移和兼容路径。
- `client-ui`：Chat 工作区、新闻、行情动态、右侧投研面板和设置；`apps/desktop` 是 Electron 壳和 sidecar。

### Agent 工具链

用户消息 → `AgentEngine` → Tool Pack Resolver 播种少量业务 pack → `AggregatingToolBroker` 聚合本地和外部 MCP → 必要时 `activate_tool_pack` 在同一会话/轮次刷新工具 → Tool handler 调用 Hub/Engine → 返回结构化数据 → 模型按研究档位输出。

关键事实源：

- 工具实现：`packages/agent/src/tools.ts`
- 工具元数据：`packages/agent/src/tool-meta.ts`
- Tool Pack 定义：`packages/shared/src/tool-packs.ts`
- 意图路由：`packages/agent/src/mcp/tool-pack-resolver.ts`、`tool-route-plan.ts`
- Agent 主循环：`packages/agent/src/engine.ts`

### 适合作为参考的能力

- 用稳定的领域标识（`InstrumentRef`）和 capability 统一跨市场数据访问。
- 通过 Hub 复用 HTTP 与 Agent 能力，避免 UI/Hub 直接调用 Provider。
- Provider Registry + 优先级回退，隔离第三方数据源变化。
- Tool Pack 动态暴露和 fail-closed，减少模型工具噪声。
- 事实、推断、时效和数据缺口分层，避免工具失败时编造结论。
- SQLite schema、配置和 API 的向后兼容与幂等迁移。

### 不应直接照搬的前提

- 多市场、行情、投研免责声明和 Provider 合规是 Opptrix 的领域约束，不能默认带入 Calen。
- 免费行情源可能延迟、限流或缺字段；任何基于它的结论都必须保留来源和时效限制。
- Electron sidecar、Node 24、Fluent UI 和端口约定是 Opptrix 的运行环境，不是 Calen 的默认技术选型。

## 3. 两份资料的关系

| 问题 | 优先参考 | 原因 |
|---|---|---|
| 本地文件、Shell、进程和桌面权限 | Calen 主工程 | 具备 Tauri 本地后端和工具执行边界 |
| 多模型流式对话、工具循环和上下文压缩 | Calen 主工程 | Chat runtime 文档和事件链更完整 |
| Memory、Skills、MCP、Cron | Calen 主工程 | 有独立运行时、持久化和 UI/远程同步设计 |
| 领域标识、数据查询、Provider 适配 | Opptrix | `InstrumentRef` + capability + registry 分层清晰 |
| 领域 Agent 工具选择和证据约束 | Opptrix | Tool Pack、路由精排和研究档位已落地 |
| Web/Electron 共用 UI 与本地服务 | Opptrix | Fastify + sidecar 结构更直接 |
| 远程控制和断线恢复 | Calen 主工程 | Gateway、gRPC、WebSocket、seq window 有明确边界 |

两份资料可以在概念上互补，但不能假设它们能无缝合并。组合前必须先定义 Calen 的领域模型、运行环境、权限边界、持久化责任和远程访问需求。

## 4. 检索入口

- Calen 总体架构：`docs/architecture/overview.md`
- Calen 对话运行时：`docs/features/chat-runtime.md`
- Calen 记忆：`docs/features/memory.md`
- Calen 工具与生态：`docs/features/tools.md`、`docs/features/skills-and-mcp.md`
- Opptrix Agent 协作规则：`Opptrix-main/docs/AGENT-GUIDE.md`
- Opptrix 分层架构：`Opptrix-main/docs/ARCHITECTURE.md`
- Opptrix 数据层：`Opptrix-main/docs/DATA-LAYER.md`
- Opptrix Agent API：`Opptrix-main/docs/API.md`

检索代码优先使用 `rg`，并从上述入口沿调用链追踪；不要只依据 README 的产品宣传文案判断实现状态。

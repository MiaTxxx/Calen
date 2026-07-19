# Calen 协作说明

面向人类协作者与 AI 助手的**硬规则**。日常开发命令、目录树与能力地图见 `CLAUDE.md` 与 `docs/`；本文件只写「必须遵守什么、改哪里、别踩什么」。

## 1. 项目定位

| 项       | 约定                                                                   |
| -------- | ---------------------------------------------------------------------- |
| 产品     | **Calen** — 本地优先的桌面 AI Agent（Tauri 2 + React/TS + Rust）       |
| 仓库     | `MiaTxxx/Calen`（本仓库根目录即主工程）                                |
| 可选远程 | Go **Gateway** + 浏览器 WebUI：中继到**正在运行**的桌面 Agent          |
| 股票     | 受控 **stock-sidecar**（证据化研究）；`Opptrix-main/` 仅为只读来源参考 |

**真相源边界：** 桌面端始终是执行与存储权威。Gateway 是有界中继，不是第二套业务库，也不浏览本机文件系统。

技术栈要点：pnpm 工作区 + Cargo 工作区 + Go 模块，主要代码在 `crates/`。

## 2. 不可违反的规则

1. **默认只改 Calen 主工程。** 仅在用户**明确要求**时修改 `Opptrix-main/`。
2. **禁止 `git add .` / `git add -A`。** 会把只读来源树 `Opptrix-main/` 一并暂存。只精确 stage 本次相关的 Calen 路径。
3. **`Opptrix-main/` 只读参考（Apache-2.0）。** 从中抽取设计、领域模块或能力接口，落到 Calen 主树；不要复制其完整 Web/Electron/API 产品层。引用时写清路径，并区分「来源工程事实」与「Calen 适配」。
4. **许可证卫生。** Calen 主工程 MIT，Opptrix Apache-2.0。复用代码保留版权与必要归属；直接复制的 Apache-2.0 代码须可追溯。
5. **品牌与兼容标识分离。** 用户可见品牌是 Calen。内部兼容标识（`.liveagent` 数据目录、`LIVEAGENT_*` 环境变量、`com.xiaofei.liveagent` app id、gRPC package、部分存储键）仍在服役——**无数据迁移与升级路径时禁止全局改名**。新增配置优先 `CALEN_*`，读取时可回退旧 `LIVEAGENT_*`。
6. **密钥与发布安全。** API Key、用户数据、更新签名私钥、远程令牌与发布操作：最小权限、显式配置、不落日志/快照明文。Gateway 快照须脱敏 Provider 凭据。
7. **股票能力只读。** 禁止自动交易、代下单、保证收益或投资建议。任何结论不得脱离**来源**与**时间**；实验分析与事实证据分区；AI 读取用户组合须有**当前请求中的明确授权**。数据失败返回 `partial` / `unavailable`，**不得编造**。

## 3. 改代码时落点

| 目标                         | 路径                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| 桌面 UI                      | `crates/agent-gui/src`                                       |
| Agent 运行时 / Builtin Tools | `crates/agent-gui/src/lib/chat`、`.../lib/tools`             |
| 高权限本地能力与持久化       | `crates/agent-gui/src-tauri/src`                             |
| 股票 sidecar                 | `crates/stock-sidecar`（及相关 Rust 运行时 crate）           |
| 远程 Gateway                 | `crates/agent-gateway`                                       |
| 浏览器 WebUI                 | `crates/agent-gateway/web`                                   |
| 架构与特性说明               | `docs/architecture/*`、`docs/features/*`                     |
| 领域用词                     | `CONTEXT.md`（桌面工作区）、`UBIQUITOUS_LANGUAGE.md`（股票） |

**命名与领域词：** 重命名概念前先查上表，避免「工作目录 / 工作空间」「asOf / retrievedAt」「证据 / 实验分析」等混用。

## 4. 按任务类型的阅读顺序

### 4.1 通用 Agent（聊天、工具、Skills、MCP、记忆、定时任务）

1. `docs/architecture/overview.md`
2. `docs/features/chat-runtime.md`
3. `docs/features/tools.md`
4. `docs/features/skills-and-mcp.md`
5. 按需：`docs/features/memory.md`、`docs/features/history-compaction.md`、`docs/architecture/protocols.md`

### 4.2 股票 / 投研

1. `docs/stock-integration-plan.md`、`docs/stock-integration-status.md`（若存在）
2. `UBIQUITOUS_LANGUAGE.md`
3. Calen 实现：`crates/stock-sidecar`、`crates/agent-gui` 中 stock 相关 UI/工具
4. 需要对照来源时再读 `Opptrix-main/` 中**具体文件**（MCP/server、research-hub、a-stock-layer、DATA-LAYER 等），并标明摘自何处

### 4.3 Gateway / WebUI / 远程工具面

1. `docs/architecture/gateway.md`、`docs/architecture/webui.md`、`docs/architecture/protocols.md`
2. 牢记：远程侧是受限工具配置文件；桌面仍是执行权威

## 5. 架构方向（决策锚点）

- **通用 Agent 是主干**；股票是独立领域模块，经稳定 seam 接入，而不是另一套桌面壳。
- 长期 seam：小而稳定的 **`StockResearch` 风格接口**。MCP、stdio、Builtin Tool 都只是 adapter；接口内隐藏 Provider 路由、缓存、限流、来源、时效与错误形态。
- 每个股票**证据结果**应可解释：来源、`asOf`（业务时间）、`retrievedAt`（获取时间）、缓存状态、警告。
- 桌面 ↔ Gateway：**单向权威**（桌面持有状态与密钥；Gateway 同步的是脱敏投影与中继会话）。

## 6. 交付前自检

提交或开 PR 前过一遍：

- [ ] 用户可见文案 / 安装包 / Release 品牌均为 **Calen**
- [ ] 未无迁移地改动 `.liveagent` / `LIVEAGENT_*` / app id / gRPC package 等兼容标识
- [ ] 变更落在 Calen 路径；未误改 `Opptrix-main/`
- [ ] 未使用 `git add .` / `git add -A`；暂存列表可人工复核
- [ ] 类型检查 / 单测 / Rust 或 Go 检查与改动风险匹配（见 `CLAUDE.md` 常用命令）
- [ ] 无 API Key、用户隐私、签名私钥泄漏
- [ ] 若复用 Apache-2.0 代码：来源路径与归属已记录
- [ ] 股票相关改动：失败路径明确、无脱离证据的结论、无交易/建议语义

## 7. 与其他文档的分工

| 文档                                    | 职责                                                      |
| --------------------------------------- | --------------------------------------------------------- |
| **本文件 `AGENTS.md`**                  | 硬规则、边界、阅读顺序、交付自检                          |
| `CLAUDE.md`                             | 给 Claude Code 的仓库地图、命令、架构摘要（并引用本文件） |
| `docs/**`                               | 可演进的设计说明、特性与运维                              |
| `CONTEXT.md` / `UBIQUITOUS_LANGUAGE.md` | 统一语言，命名与产品语义的准绳                            |

有冲突时：**安全、许可证、只读来源树、桌面真相源、股票只读** 以本文件为准；实现细节以代码与 `docs/` 最新说明为准。

# 模型角色路由（Model Role Routing）

按任务/角色使用不同模型：主对话、压缩、标题、翻译、截屏即问、子代理、视觉、生图。

## 角色一览

| 角色        | 设置字段                                           | 回退链                                            |
| ----------- | -------------------------------------------------- | ------------------------------------------------- |
| 主对话 chat | `selectedModel`                                    | （无）                                            |
| 标题        | `customSettings.conversationTitleModel`            | → chat                                            |
| 翻译        | `customSettings.translationModel`                  | → chat                                            |
| 压缩        | `customSettings.compactionModel`                   | → chat                                            |
| 截屏即问    | `customSettings.quickAskModel`                     | → chat → 第一个可用模型                           |
| 子代理默认  | `customSettings.subagentDefaultModel`              | → 父 turn                                         |
| 子代理模板  | `agents[].selectedModel`                           | → 子代理默认 → 父 turn                            |
| 视觉        | `customSettings.visionModel` + `visionRoutingMode` | auto：→ quickAsk → chat（需 vision）；off：不切换 |
| 生图        | `customSettings.imageGenModel`                     | → 主模型（仅当标记 `image_gen`）                  |
| 顾问        | `customSettings.advisorModel`                      | 无配置则禁用入口                                  |

记忆整理 `memory.organizerModel` / 对话总结 `memory.summaryModel` 仍在 Memory 设置中，语义保持原样。

## 设置入口

1. **Provider → 自定义设置**：任务模型分区（标题、翻译、压缩、截屏即问、子代理默认、视觉/路由、生图、顾问）
2. **Prompt 模板**：每个模板可指定子代理模型
3. **模型设置弹窗**：勾选「支持看图 / 支持生图」（写入 `ProviderModelConfig.capabilities`）

未选择专用模型时，UI 显示「使用当前对话模型」（生图/顾问显示「未配置」并禁用对应能力）。

## 运行时行为

### 视觉路由（主对话发图）

1. 若主模型支持 vision → 不切换
2. 否则：
   - `visionRoutingMode=auto`：按 `visionModel → quickAskModel → chat` 找第一个支持 vision 的模型
   - `visionRoutingMode=off`：不切换，直接报错
3. 切换成功 → info toast 提示实际模型
4. 自动路由下全部不可用 → **阻断发送**，error toast + 会话错误状态

### 顾问复审

- 配置 `advisorModel` 后，助手消息旁显示「顾问复审」按钮
- 调用固定 system prompt 的非流式二次点评，结果弹层展示
- 未配置模型时提示去设置

### 子代理

每个 Agent job 独立解析：`模板 selectedModel → subagentDefault → 父 turn`。  
子代理 runtime 默认关闭 thinking / native web search。

### 生图 `GenerateImage`

- 配置了 `imageGenModel`（或主模型标记 `image_gen`）时，在 **Agent 模式**注册工具
- 当前仅 OpenAI 兼容（`codex`）`/images/generations`
- 结果在工具气泡中展示 prompt / model / 图片预览

## 关键代码

- 路由：`src/lib/settings/modelRouting.ts`
- 能力：`src/lib/providers/capabilities.ts`、`modelFactory.ts`
- 生图工具：`src/lib/tools/imageGenTools.ts`
- 顾问：`src/lib/chat/advisor/review.ts`
- 视觉发送：`src/pages/ChatPage.tsx`
- 设置 UI：`ProvidersSection.tsx`、`AgentPromptTemplateModal.tsx`

## 不做 / 已知边界

- Advisor 完整多轮辩论/编排尚未实现（当前为轻量二次点评）
- 生图未支持 Claude/Gemini 原生接口
- Gateway 远端 turn 不注册子代理与生图工具
- Gateway Web 同步字段已对齐类型，运行权威仍在桌面端
- Cherry 导入会排除纯生图/嵌入模型；视觉理解模型（如 qwen-vl）应保留

## 建议配置

| 场景              | 建议                                    |
| ----------------- | --------------------------------------- |
| 主对话            | 主力文本模型                            |
| 压缩 / 子代理默认 | 更便宜的小模型                          |
| 视觉 / 截屏即问   | 支持看图的模型                          |
| 生图              | OpenAI 兼容生图模型，并勾选「支持生图」 |

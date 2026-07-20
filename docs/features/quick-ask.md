# Quick Ask（截屏即问）

看不懂的公式、报错、图表——在任意应用里按下全局快捷键，框选屏幕区域，置顶小窗直接向 AI 提问，无需切到主窗口。

## 交互流程

| 步骤 | 说明                                                                                                                                           | 关键模块                                                       |
| ---: | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
|    1 | 全局快捷键触发（默认 Windows/Linux 显示 `Ctrl+Shift+A`，macOS 显示 `⌘+Shift+A`；内部存 `CmdOrCtrl+Shift+A`。可在 系统设置 中改键或清空禁用）。 | `tauri-plugin-global-shortcut`、`quick_ask.rs`                 |
|    2 | Rust 用 `xcap` 截取光标所在显示器整屏（先截图再开窗，避免遮罩把自己截进去）。                                                                  | `quick_ask.rs::capture_monitor_at_cursor`                      |
|    3 | 弹出全屏无边框置顶遮罩窗 `snip-overlay`，前端展示冻结画面并拖拽框选。                                                                          | `SnipOverlayApp.tsx`、`lib/quick-ask/selection.ts`             |
|    4 | 确认选区后 Rust 裁剪出 PNG，关闭遮罩，弹出置顶小窗 `quick-ask`（靠近光标）。                                                                   | `quick_ask_confirm_selection`                                  |
|    5 | 小窗取走截图，输入问题后走前端既有 provider 流式管线（本地代理、凭据、模型；可配 `quickAskModel`，适合 vision）。                              | `QuickAskApp.tsx`、`lib/quick-ask/model.ts`、`modelRouting.ts` |
|    6 | 截图以 provider 原生 image 内容块随首条用户消息发送；支持多轮追问、Esc 中断。                                                                  | `buildQuickAskUserMessage`、`streamAssistantMessage`           |

## 实现约束（踩坑记录）

- **窗口创建/销毁必须回到主线程事件循环**：Windows 上，Tauri v2 同步 command 在 IPC 分发中重入式 `WebviewWindowBuilder::build()` 会让窗口停在不可见状态；从 tokio 工作线程直接 build 则会卡住不返回。正确做法是 async command + `app.run_on_main_thread(...)` 里做窗口操作（`quick_ask_confirm_selection` 即此模式）。
- **遮罩窗就绪握手**：遮罩窗以 `visible(false)` 创建，前端截图 `<img>` `onLoad` 后调用 `quick_ask_overlay_ready` 才显示。否则会有"遮罩已显示但 JS 未加载完、拖拽无效"的窗口期（dev 下可达数秒）。
- **同 label 不能在同一事件循环回合 destroy + 重建**：遮罩已打开时再按快捷键按"取消"处理，不做销毁后立刻重建。
- 三个窗口根组件在 `main.tsx` 里按需加载（`React.lazy`），遮罩窗只拉取自己的小 chunk。

## 设计要点

- **三窗一入口**：`snip-overlay` / `quick-ask` 与主窗口共用同一个前端 bundle，`main.tsx` 按 Tauri 窗口 label 分流；两个新 label 已加入 `capabilities/default.json`。
- **模型选择**：优先 `customSettings.quickAskModel`；否则复用主对话当前选中的模型（localStorage 同源共享）；再回退到第一个配置了 API Key 且有可用模型的 provider；都没有则提示去主窗口配置。详见 `docs/features/model-routing.md`。
- **对话不落盘**：小窗对话只存内存，不写聊天历史；关闭窗口即丢弃。再次截图会通过 `quick-ask:new-shot` 事件重置小窗对话。
- **快捷键持久化**：`quickAskHotkey` 存在 system settings（SQLite），Rust 启动时读取注册；`settings_save_system` 保存后立即重注册。缺失 → 默认值；显式空字符串 → 禁用（前后端归一化语义一致）。注册失败会返回错误给设置页，并通过 `quick-ask:error` 事件通知主窗口。
- **遮罩就绪兜底**：遮罩默认 `visible(false)`，前端截图 `onLoad` 后 `quick_ask_overlay_ready` 再显示；若约 1.8s 内未握手成功则强制显示，避免“按了没反应”。
- **二次快捷键语义**：遮罩已可见时再按快捷键 = 取消；若遮罩存在但不可见（卡死），再按会销毁并重建，而不是只取消。
- **思考/缓存关闭**：快捷提问固定 `reasoning: off`、不启用 prompt caching 与联网搜索，追求响应速度。
- **多显示器**：按光标位置定位显示器，仅截取该屏；选区坐标按「视口 CSS px → 截图物理 px」比例换算，不直接信任 scaleFactor。

## 已知边界

- 快捷键字符串会做基础归一化（Ctrl/Cmd/Shift、主键大写），注册失败时检查是否与系统/其他应用冲突（例如部分 GPU/截图软件占用 Ctrl+Shift+A）。
- Wayland 下 xcap 截屏能力受桌面环境限制；主要支持目标为 Windows / macOS。
- Windows 上同一 label 在同一事件循环回合 destroy + 立即 rebuild 仍应避免；取消/重建路径依赖“先 destroy，下一触发再 build”。

# ADR 0002：设备本地应用代理与离线翻译 seam

- 状态：Accepted
- 日期：2026-07-18

## 背景

Calen 的模型请求、Skills 商店、更新检查、股票 sidecar 和子进程分别使用 WebView、Rust reqwest、Tauri updater 与 Node fetch，代理行为不一致。Skills 商店描述翻译当前直接调用远程 Provider，缺少本地隐私模式与可选模型管理。

## 决策

建立两个彼此独立的深模块：

1. `AppNetworkManager` 的接口只暴露直连、跟随系统、手动 HTTP、状态检查和受控子进程环境。首发 Windows 读取系统静态代理与代理环境变量；未发布的 macOS/Linux 构建当前只读取代理环境变量，并必须在状态与设置文案中明确这一限制。代理偏好与凭据属于设备本地状态，不进入 Gateway settings snapshot。
2. `TranslationPort` 的接口只接收文本、目标语言和用途，返回译文、实际 backend、模型和警告。调用方不感知 Provider、llama.cpp、下载状态或进程生命周期。

离线实现由 `OfflineTranslationManager` 负责模型目录、断点续传、SHA-256、用户导入和 llama.cpp 进程。Windows 安装包携带从固定提交自行构建的 CPU runtime（静态项目库、静态 MSVC runtime、OpenMP 关闭），避免复用上游发布物中的 `debug_nonredist` DLL；模型权重必须由用户明确下载或导入。

首个全球公开目录项采用 Apache-2.0 的 Qwen3-0.6B-GGUF Q8_0。HY-MT1.5 因 Tencent HY Community License 的地区和分发限制，不进入全球下载目录，只允许用户导入本地已合法取得的 GGUF，直至获得书面合规批准。

## 约束

- 手动代理失败不得静默直连。
- localhost、127.0.0.1 和 ::1 始终绕过代理。
- `offline-only` 不得触发任何远程翻译请求。
- `offline-preferred` 的远程回退必须在用户已选择该模式时发生，并向 UI 返回警告。
- 下载只接受内置 model ID；任意本地模型只能通过文件导入。
- 模型下载使用 `.part`、Range 续传、固定大小和 SHA-256，校验通过后原子入位。
- llama.cpp 只绑定 127.0.0.1、随机端口和随机 API Key，关闭 WebUI、工具和不必要端点。
- 模型路径、待翻译原文、代理凭据和 Provider Key 不进入 Gateway 普通同步或诊断日志。

## 结果

Skills 商店可复用同一个翻译 seam；未来加入其他 GGUF 模型、已有 Ollama adapter 或 WebUI 远程调用时，不需要修改 Skills 页面。网络策略集中后，Provider、Skills、更新和 sidecar 不再各自解释代理设置。

# ADR 0002：设备本地应用代理与离线翻译 seam

- 状态：Accepted
- 日期：2026-07-18
- 最近修订：2026-07-19

## 背景

Calen 的模型请求、Skills 商店、更新检查、股票 sidecar 和子进程分别使用 WebView、Rust reqwest、Tauri updater 与 Node fetch，代理行为不一致。Skills 商店描述翻译当前直接调用远程 Provider，缺少本地隐私模式与可选模型管理。

## 决策

建立两个彼此独立的深模块：

1. `AppNetworkManager` 的接口只暴露直连、跟随系统、手动 HTTP、状态检查和受控子进程环境。首发 Windows 读取系统静态代理与代理环境变量；未发布的 macOS/Linux 构建当前只读取代理环境变量，并必须在状态与设置文案中明确这一限制。代理偏好与凭据属于设备本地状态，不进入 Gateway settings snapshot。
2. `TranslationPort` 的接口只接收文本、目标语言和用途，返回译文、实际 backend、模型和警告。调用方不感知 Provider、llama.cpp、下载状态或进程生命周期。

离线实现由 `OfflineTranslationManager` 负责模型目录、断点续传、SHA-256、用户导入和 llama.cpp 进程。Windows 安装包携带从固定提交自行构建的 CPU runtime（静态项目库、静态 MSVC runtime、OpenMP 关闭），避免复用上游发布物中的 `debug_nonredist` DLL；模型权重必须由用户明确下载或导入。

Tioms 已确认获得将 HY-MT1.5 作为 Calen 应用内下载项的合规批准。该确认不替代、扩张或修改 Tencent HY Community License Agreement 授予的权利。Calen 安装包不内置模型权重；模型目录默认推荐 HY-MT1.5 1.8B Q4_K_M，并提供 Q8_0 高质量选项。Apache-2.0 的 Qwen3-0.6B-GGUF Q8_0 保留为兼容现有安装及不适用 HY-MT 许可地区的兜底选项。

HY-MT 下载项只接受以下固定产物：

| 变体                        | Hugging Face revision                      | ModelScope revision                        |            精确大小 | SHA-256                                                            |
| --------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------: | ------------------------------------------------------------------ |
| `HY-MT1.5-1.8B-Q4_K_M.gguf` | `265b2e615a7dc9b06c435dc878829ad99a512ba2` | `acac2122e32c8d7e6221fb135f918f6e6c87ce49` | 1,133,080,512 bytes | `4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7` |
| `HY-MT1.5-1.8B-Q8_0.gguf`   | `265b2e615a7dc9b06c435dc878829ad99a512ba2` | `acac2122e32c8d7e6221fb135f918f6e6c87ce49` | 1,908,528,288 bytes | `6789b06d0902f2f5312c0e1703d56ccbddfcfb6c653d22519b7c720f7db9a98e` |

下载前必须展示模型 revision、SHA-256，并要求用户明确接受该固定 Hugging Face revision 中的 [Tencent HY Community License Agreement](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/blob/265b2e615a7dc9b06c435dc878829ad99a512ba2/License.txt) 及其 Acceptable Use Policy。其 Territory 明确排除欧盟、英国和韩国；这些地区不得下载、使用或展示 HY-MT 及其输出，应用应保持 Qwen 或远程 Provider 可选。许可原文和第 3(d) 节要求的 Notice 随 Windows 安装资源分发，分别位于 `translation-runtime/licenses/Tencent-HY-Community-License.txt` 和 `translation-runtime/licenses/Tencent-HY-NOTICE.txt`。

Calen 及其 HY-MT 离线翻译功能的实际提供者完整法定名称为 **Tioms**。设置页和许可门禁必须清楚、准确、醒目地说明：Tencent 与 Tioms 或 Calen 无关联、无合作关系，不赞助也不为该应用或功能背书。不得使用 Tencent 名称、标识或商标制造关联、赞助或背书的误解。

## 约束

- 手动代理失败不得静默直连。
- localhost、127.0.0.1 和 ::1 始终绕过代理。
- `offline-only` 不得触发任何远程翻译请求。
- `offline-preferred` 的远程回退必须在用户已选择该模式时发生，并向 UI 返回警告。
- 下载只接受内置 model ID；任意本地模型只能通过文件导入。
- 模型下载使用 `.part`、Range 续传、固定大小和 SHA-256，校验通过后原子入位。
- HY-MT 下载必须在用户自证位于许可 Territory、接受完整许可与 Acceptable Use Policy、确认实际提供者和无关联声明后才可开始；每次开始下载都以当前固定 revision 展示并重新确认。确认结果以本地 receipt 绑定 model ID 与许可 revision；使用内置 HY-MT 前必须重新校验该 receipt，许可变化、记录缺失或损坏时不得沿用旧确认。
- HY-MT 不得在欧盟、英国或韩国下载、使用、复现、修改、分发或展示其输出；不得利用 HY-MT 或其输出改进 Tencent HY 或其 Model Derivative 以外的 AI 模型。
- 若 Tioms 的全部产品或服务在 HY-MT 版本发布日期对应的前一个日历月超过 1 亿月活跃用户，必须先取得 Tencent 另行授予的许可，不能继续依赖社区许可。
- llama.cpp 只绑定 127.0.0.1、随机端口和随机 API Key，关闭 WebUI、工具和不必要端点。
- 模型路径、待翻译原文、代理凭据和 Provider Key 不进入 Gateway 普通同步或诊断日志。

## 结果

Skills 商店可复用同一个翻译 seam；未来加入其他 GGUF 模型、已有 Ollama adapter 或 WebUI 远程调用时，不需要修改 Skills 页面。网络策略集中后，Provider、Skills、更新和 sidecar 不再各自解释代理设置。

# Calen Offline Translation Runtime

Calen 的 Windows 离线翻译功能携带固定版本的 llama.cpp CPU x64 运行时，模型权重不包含在安装包中，只有用户明确点击下载或导入后才会写入本机数据目录。

- 项目：llama.cpp
- 来源：https://github.com/ggml-org/llama.cpp
- 固定版本：b10066
- 固定提交：`86a9c79f866799eb0e7e89c03578ccfbcc5d808e`
- 构建方式：Calen Release CI 从固定源码自行构建 `llama-server.exe`
- 构建约束：Windows x64、静态项目库、静态 MSVC runtime、OpenMP 关闭、Web UI 关闭、OpenSSL 关闭
- 许可证：MIT License，见 `licenses/llama.cpp-MIT.txt`

Calen 不分发上游 Windows ZIP 中来自 Visual Studio `debug_nonredist` 目录的 `libomp140.x86_64.dll`。运行时清单会记录源码提交、构建约束和最终二进制 SHA-256。

离线模型目录中的模型保留各自许可证。安装资源不包含模型权重；用户只有在应用内明确选择下载或导入后，模型才会写入本机应用数据目录。

## HY-MT1.5 应用内下载项

Tioms 已确认取得将 HY-MT1.5 作为 Calen 应用内下载项的合规批准。下载仍严格受 Tencent HY Community License Agreement 约束，批准不替代或扩张许可授予的权利。

- 模型来源：https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF
- 固定 Hugging Face revision：`265b2e615a7dc9b06c435dc878829ad99a512ba2`
- 固定 ModelScope revision：`acac2122e32c8d7e6221fb135f918f6e6c87ce49`
- 许可原文来源：https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/265b2e615a7dc9b06c435dc878829ad99a512ba2/License.txt
- 许可原文核对：2026-07-19；上游 `License.txt` 为 16,270 bytes，Git blob/ETag 为 `1b502c594266512e3f80deb4e021b9b52024f671`
- 随附许可原文：`licenses/Tencent-HY-Community-License.txt`
- 随附分发 Notice：`licenses/Tencent-HY-NOTICE.txt`

| 文件                        |            精确大小 | SHA-256                                                            |
| --------------------------- | ------------------: | ------------------------------------------------------------------ |
| `HY-MT1.5-1.8B-Q4_K_M.gguf` | 1,133,080,512 bytes | `4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7` |
| `HY-MT1.5-1.8B-Q8_0.gguf`   | 1,908,528,288 bytes | `6789b06d0902f2f5312c0e1703d56ccbddfcfb6c653d22519b7c720f7db9a98e` |

许可 Territory 为全球但明确排除欧盟、英国和韩国。Calen 必须在下载前展示固定 revision 与 SHA-256，要求用户确认其所在地区适用、接受完整许可与 Acceptable Use Policy，并将本地确认 receipt 绑定到 model ID 和许可 revision；内置 HY-MT 每次使用前会校验该 receipt，在不适用地区不得下载或使用。

Calen 及其 HY-MT 离线翻译功能的实际提供者完整法定名称为 **Tioms**。Tencent 与 Tioms 或 Calen 无关联、无合作关系，不赞助也不为 Calen、其离线翻译功能或任何输出背书。

Qwen3-0.6B-GGUF Q8_0 继续作为 Apache-2.0 兼容模型和 HY-MT 许可不适用地区的兜底选项。用户导入的其他 GGUF 文件由用户自行确认授权。

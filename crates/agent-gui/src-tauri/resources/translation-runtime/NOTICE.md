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

离线模型目录中的模型保留各自许可证。Calen 首个内置下载项为 Qwen3-0.6B-GGUF Q8_0，来源和许可证会在下载前展示；用户导入的 GGUF 文件由用户自行确认授权。

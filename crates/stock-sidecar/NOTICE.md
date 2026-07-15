# Third-party notice

本模块的跨市场标的、Provider Registry、能力路由、缓存、免费数据源冷却和证据元数据设计参考了以下来源工程：

- Opptrix，Apache License 2.0
- 上游作者：Opptrix contributors
- 上游项目主页：<https://www.opptrix.org>
- 上游源代码：<https://github.com/Travisun/Opptrix>
- 来源目录：`Opptrix-main/packages/a-stock-layer`、`Opptrix-main/packages/research-hub`、`Opptrix-main/packages/stock-eval`
- 上游许可证：`Opptrix-main/LICENSE`

当前文件清单中没有逐行复制的 Opptrix 源文件；Calen 适配实现是面向独立 JSON-RPC sidecar 的重新实现，没有引入 Opptrix 的 Electron、Fastify、React UI、DuckDB、better-sqlite3 或完整 ToolRegistry。若后续直接复制或修改 Opptrix 源文件，必须在本文件补充具体文件、上游提交号、版权声明和修改说明，并随分发物携带 Apache License 2.0 文本。

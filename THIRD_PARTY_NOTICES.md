# Third-Party Notices

## Opptrix

Calen 的股票研究模块参考并可能包含源自 Opptrix 的代码或经修改的实现。

- 上游项目：Opptrix
- 上游地址：https://github.com/Travisun/Opptrix
- 项目主页：https://www.opptrix.org
- 上游版权：Copyright © 2026 Opptrix contributors
- 来源目录：`Opptrix-main/`
- 来源版本：用户提供的本地源码快照；该目录不含独立 Git 元数据，无法可靠恢复上游提交号
- 上游许可证：Apache License 2.0
- 参考模块：`packages/a-stock-layer`、`packages/research-hub`、`packages/agent`、`packages/stock-eval`
- Calen 中的目标模块：`crates/stock-sidecar`

本轮实现参考了上述模块的领域边界、Provider Registry、公告正文和研究工具设计，但 `crates/stock-sidecar` 为面向 Calen 稳定接口重新实现，没有逐文件直接复制 Opptrix 源码。若后续引入逐字复制或实质改编文件，必须在此追加“上游文件 → Calen 文件”的清单、保留版权头与修改说明，并随发行物提供 Apache-2.0 许可证文本；本文件不能替代许可证原文。

目前的架构术语和模块边界借鉴不代表外部市场数据的授权。腾讯与东方财富的首版工程/产品约束记录见 `docs/provider-compliance-review.md`。新浪、BaoStock、Tushare、ZZShare、TickFlow、Fuyao 等数据或服务分别受其自身条款约束；在完成独立审查前不得默认启用或将数据随安装包分发。

Calen 展示的市场信息可能延迟、不完整或错误，仅供研究与信息参考，不构成投资建议、交易邀约或收益保证。

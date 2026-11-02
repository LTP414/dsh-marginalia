# docs/ — 设计、架构与验证记录

本目录是项目判断的长期记录，不参与构建。修改代码后检查对应文档是否仍准确，尤其是测试数量、已知限制和验证结论。

## 文件

| 文件 | 内容 | 何时更新 |
| --- | --- | --- |
| `three-way-analysis.md` | 对 oh-my-pi `/btw`、MichengAI、WLV、kaieye 的源码级研判；项目设计输入（632 行，历史文档） | 一般不改；若重做选型，追加日期/结论而不是覆盖 |
| `architecture.md` | 当前实现的决策记录：prefix、guard、job 生命周期、topic、streaming、transport、storage、insert、失败矩阵 | 改 Host/Client 架构、传输、生命周期时 |
| `e2e.md` | 浏览器套件的隔离 Host、鉴权、fake LLM、非 secure origin、spec 列表、nightly | 改 `e2e/` 或 CI 时 |
| `verification.md` | 实际执行结果、覆盖范围、剩余缺口、手动清单、cache 说明 | 每次发版/测试结果变化时 |

## 阅读顺序

1. 新接手：`README.md` → `verification.md` → `architecture.md` → 代码子目录 `AGENTS.md`。
2. 做设计判断：`three-way-analysis.md` 的契约 C1–C9，再看 `architecture.md` 哪些做了/没做。
3. 跑测试：`e2e.md` + `verification.md`。
4. 准备发布：`verification.md` 的剩余缺口 + `e2e.md` 的 nightly 说明。

## 写作规则

- **区分“已实现”和“计划/降级”**。不要把 best-effort archive 写成真 ephemeral，不要把 command RPC 写成原生 Remote。
- 更新 `verification.md` 时写实际命令与结果（测试数、通过/跳过、日期、DSH 版本），不要只写“已通过”。
- 修改架构时同步 `architecture.md` 和根 `AGENTS.md` 的边界；如果新增子目录，补根导航和子目录 `AGENTS.md`。
- 测试数量/覆盖率变化时同步 `README.md`、`README.zh-CN.md`、`verification.md`，必要时 `CHANGELOG.md`。
- 不把用户 profile 路径、token、真实密钥写进文档。
- 历史研判文档保留原貌；后续结论放到新章节或新文档，避免抹掉推理过程。

## 与其他目录的关系

- `docs/` 只描述，不实现；代码改动以 `src/` 为准。
- `e2e.md` 的细节与 `e2e/AGENTS.md` 保持一致；后者面向修改测试，前者面向运行/理解。
- `three-way-analysis.md` 是输入资料，不是当前 API 的权威；实际行为以代码和 `architecture.md` 为准。

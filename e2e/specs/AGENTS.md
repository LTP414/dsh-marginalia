# e2e/specs/ — 浏览器验收场景

本目录只放 Playwright `test()`。共享 fixture 在 `../fixtures/dsh.ts`，Host/UI helper 在 `../support/`。

## `btw.spec.ts`（7 条，默认运行）

`test.beforeEach` 调 `openApp(page, host)`；每个 test 使用新的 browser context，默认打开当前 workspace 的空白 session。不要依赖前一个 test 的 session/bubble。

| 行 | 场景 | 关键断言 |
| --- | --- | --- |
| 21 | slash menu + 流式 + 主记录不变 | `[data-testid=marginalia-bubble]` 出现；answer 长度用 `expect.poll` 增长；不包含父回答；`[data-chat-node-key]` 数量不变；`chatFlow` 不包含侧问题；`archivedChild()` 为 true |
| 42 | Stop + 历史 | 运行中 Stop；`data-status=cancelled`；answer 保留 partial；历史面板包含 `Cancelled` 与 partial |
| 63 | Follow-up | 第一条 complete；点 Follow up；textarea 输入 `And then?` Enter；出现第二个 bubble；历史显示 `2 turns` |
| 84 | Reload | 完成后 reload + `resumeApp`；无气泡重建；seed 文本仍在；历史仍有答案 |
| 101 | 只读 guard | `[tool]` 触发 fake bash；bubble 文本含 `read-only guard blocked`；`host.toolPath` 不存在；节点数不变 |
| 113 | 插入输入框 | 点 `marginalia-insert`；composer 含 answer；主节点数不变 |
| 124 | 非 secure origin | `host.insecure` 才运行；`typeof crypto.randomUUID === 'undefined'`；仍能完成 `/btw` |

### fake prompt 标记

fake LLM 由问题文本决定行为（详见 `../fixtures/fake-llm/AGENTS.md`）：

- `[slow]`：110ms/token，用于流式/Stop。
- `[tool]`：子会话发起 `bash touch <DSH_E2E_TOOL_PATH>`，用于 guard。
- 其他：立即返回 `Side answer: <question>`。

### 归档断言

`archivedChild(home, question)` 直接读：

- `storages/marginalia.json` 找 question 对应的 turn/childSessionId
- `storages/workspace.json` 的 `global.archivedSessionIds`

它验证真实 archive 路径，不只是 mock。归档是 best-effort，所以用 `expect.poll`。

## `real.nightly.spec.ts`（1 条，默认跳过）

- 文件顶部 `test.skip(DSH_E2E_REAL !== '1')` 和 `!DEEPSEEK_API_KEY`。
- 使用 base `@playwright/test`（不是 `fixtures/dsh.ts`），自己 `startE2EHost({ real: true })`，不加载 fake bundle。
- 流程：打开 App → seed → `/btw` → 等 `complete` → 断言 answer 非空。
- 只放 nightly/发布前，不进确定性 CI。

## 新增 spec 的规则

1. 用 `import { expect, test } from '../fixtures/dsh'`，这样自动获得 worker-scoped `host`。
2. `beforeEach` 用 `openApp`；需要 reload 时用 `resumeApp`，不要重复走 token。
3. 用 `../support/ui` 的 helper 和 `data-testid`；不要依赖 Lexical class / 绝对坐标。
4. 等待用 `expect`/`expect.poll`；`waitForTimeout` 只允许用于流式采样，并且不能作为唯一成功条件。
5. 每个 test 自包含：自己的 seed、自己的 session；不要复用上一个 test 的 topic。
6. 如果新增 fake 行为，先改 `fixtures/fake-llm/index.js`，再在 spec 使用对应标记；不要联网。
7. 失败产物在 `.e2e-runs/artifacts`；host 日志在 `.e2e-runs/host-*/host.log`。

## 不要做

- 不要为了通过测试关闭鉴权、改 Host/Origin fence、复用用户 profile。
- 不要在 spec 里直接调用 `btw-ask` 绕过 UI；这样就不能证明 slash menu/claim。
- 不要把真实 provider 放进默认 spec；保持 fake 确定性。
- 不要删除 `data-testid`/`data-status`；如果 UI 必须改，先更新 helper 和 `src/client/AGENTS.md`。

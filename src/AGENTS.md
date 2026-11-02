# src/ — 源码入口与同构核心

本目录同时包含 Host 入口、共享协议/提示词模块，以及 Host/Client 两个实现子目录。阅读顺序建议：本文件 → `src/index.ts` → 需要修改的那一半（`host/` 或 `client/`）。

## 目录结构

```
src/
  index.ts        Host 插件入口与装配
  shared.ts       同构协议、prompt、历史重放、错误/回答清洗、摘要
  limits.ts       单一来源的硬上限（问题/引用/答案/主题/并发/超时）
  random.ts       安全/非安全上下文都可用的 v4 UUID 生成
  host/           Host 实现（见 host/AGENTS.md）
  client/         Web Client 实现（见 client/AGENTS.md）
```

## 文件职责

### `src/index.ts` — Host 入口

- 导出 Cordis 插件契约：`name = 'dsh-marginalia'`、`inject = ['commands','subagents','tools']`、`apply(ctx)`。
- `apply` 的顺序很重要：
  1. 打开 `BtwStore`（storage domain 或内存 fallback）。
  2. 创建 `ChildGuard` 与 `StreamCapture`，注册 root `ctx.tools.guard`、`agent/created`、`agent/assistant-stream`。
  3. 定义 `startChild`：只接受 `fork` provider，且要求 `inheritsParentContext`；调用 `ctx.subagents.startActivation({ delivery: 'caller' })`。
  4. 定义 `archiveChild`：`workspaceRegistry.archiveSession`，best-effort。
  5. 构造 `BtwEngine`，安装 `hideInternalCommands` + `quietInternalCommands`。
  6. 注册 `btw-*` 内部命令。
  7. 注册清理 effect：先撤命令、恢复 list/lifecycle、停止事件监听，再 `engine.dispose()`、释放 guard、关闭 store。
- 这里只做装配；业务逻辑在 `host/`。

### `src/shared.ts` — 双端共享协议

这是 Host 与 Client 唯一的协议来源，不能引入 DOM/Node 专属运行时或 `@deepseek-ai/*` 运行时依赖（类型导入除外）。

- 常量：`PLUGIN_NAME`、`LOCALE_NS`、`BTW_COMMAND`、内部命令名、`INTERNAL_COMMANDS`。
- 数据类型：`BtwStatus`、`BtwTurn`、`BtwTopic`、`BtwTopicSummary`、`AskRequest/AskAccepted`、`List/Get/Cancel/Delete` 请求响应。
- 校验：`parseAskRequest`、`parseListRequest`、`parseGetRequest`、`parseCancelRequest`、`parseDeleteRequest`、`isUuid`、`isBtwLocale`；错误统一为 `BtwRequestError`。
- 传输：`commandLine(name, payload)` 生成 `/btw-ask {...}` 形式的隐藏命令。
- prompt：`buildPrompt` 生成单条 user prompt，包含 `<btw>` 指令、`<btw-history>`、`<parent-in-progress>`、`<quoted-context>`、`Question:`。**不要把这段放进 system prompt，也不要改工具表。**
- 历史：`formatHistory` 按上限从最新轮次回放，单块超长截断；`lastCompletedTurn` 的实现不在本文件，在 `host/parent-context.ts`。
- 清洗：`sanitizeAnswer`（去 tool-call 伪影、控制字符、按 UTF-8 截断）、`sanitizeError`（单行、去路径/密钥）、`truncateUtf8`、`summarizeTopic`、`titleOf`。
- 常量导出 `LIMITS` 供文档/测试使用；真正的数值在 `limits.ts`。

### `src/limits.ts`

所有跨 Host/Client/测试共享的硬上限；改数值会影响 prompt、校验、UI 和测试。当前包括：

- `MAX_QUESTION_LENGTH` 8k、`MAX_REFERENCE_LENGTH` 8k、`MAX_HISTORY_CHARS` 64k、`MAX_ANSWER_BYTES` 256 KiB。
- `MAX_TOPICS_PER_SESSION` 50、`MAX_TURNS_PER_TOPIC` 200、`MAX_ACTIVE_BTW` 4、`DEFAULT_TIMEOUT_MS` 10 分钟、`CLEANUP_TIMEOUT_MS` 5s、`MAX_SIDE_OUTPUT_TOKENS` 32k。
- 改上限时同步检查 `shared.ts` 的校验、`host/engine.ts` 的任务控制、`client/store.ts` 的输入校验和 `tests/shared.test.ts`。

### `src/random.ts`

`randomId()`：

1. 优先 `crypto.randomUUID()`；
2. 非安全上下文（LAN HTTP）没有 `randomUUID`，退回 `crypto.getRandomValues()` 构造 v4 UUID；
3. 两者都没有时用合法 v4 形状的兜底。

不要改回直接调用 `globalThis.crypto.randomUUID()`；`tests/random.test.ts` 和浏览器 spec 覆盖该故障路径。

## 双端边界

- `shared.ts` / `limits.ts` / `random.ts` 可被 Host 和 Client 同时导入，构建时会各自打包。
- Host 代码只能通过 type-only import 使用 `@deepseek-ai/*` 类型；Host bundle 不依赖外部 DSH 运行时。
- Client 代码不能导入 Node 内置模块；浏览器 bundle 只 externalize React。
- 协议变更必须同时改 Host 命令、Client bridge、单测和/或 e2e。

## 构建与测试

- `npm run typecheck`：包含 `src`、`tests`、`e2e`、`playwright.config.ts`。
- `npm run build`：`scripts/build.mjs` 产出 `lib/index.js`、`lib/client.js` 和 `lib/types/`；`lib/` 是生成物，禁止手改。
- 单测：`npm test`。
- 浏览器：`npm run test:e2e`（会先 build）。

## 修改建议

- 改 prompt/协议/清洗：`src/shared.ts` + `tests/shared.test.ts`；涉及 UI 显示时再补 `src/client/` 测试。
- 改 Host 行为：进入 `src/host/AGENTS.md`。
- 改 Client 行为：进入 `src/client/AGENTS.md`。
- 新增共享常量前先确认是否真的双端都需要；只在一端使用的值放对应子目录。

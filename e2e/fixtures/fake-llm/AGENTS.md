# e2e/fixtures/fake-llm/ — 确定性 LLM bundle

这是一个独立、非发布用的 DSH bundle，只供 `e2e/` 使用。它让浏览器验收不依赖网络、凭据和真实模型抖动。

## 文件

- `package.json`：包名 `dsh-e2e-fake-llm`，`type: module`，`main: index.js`，`dsh.bundle.patch: ./cordis.patch.yml`。
- `cordis.patch.yml`：插入 `id: e2e-fake-llm`。
- `index.js`：`name`、`inject: ['llm']`、`apply(ctx)`；注册 `fake` provider 的 duck-typed adapter。

## Adapter 契约

不继承 `LlmAdapter`（避免运行时依赖），而是实现 LLM runtime 实际调用的方法：

- `providerInfo(provider)` → `{ id, name: 'E2E Fake LLM' }`
- `providerRetryPolicy()` → `undefined`
- `imageRequestPricing()` → `undefined`；`imageRequestTarget()` 原样返回尺寸/字节
- `listModels(provider)` → `[{ provider, id:'fake-1', name:'Fake 1', inputModalities:['text'] }]`
- `resolveModel(provider, model)` → context 200k、defaultMaxTokens 8192、`systemPromptUpdate:'in-history'`
- `prepareCall(provider, model, signal)` → `{ model, stream: options => this.stream(options) }`
- `stream(options)` → `AsyncIterable<StreamChunk>`

## 流行为

`stream` 根据 `options.messages` 决定输出：

- 最后一条是 `tool` → 返回 `The read-only guard blocked the tool. The file was not changed.`
- 任一 user message 含 `<btw>` 且能抽出 `Question:`：
  - 问题含 `[tool]` → 发出 `bash` tool-call block，arguments 为 `{command:'touch <DSH_E2E_TOOL_PATH>'}`，finish `{kind:'tool-calls'}`
  - 含 `[slow]` → 逐 token，间隔 `DSH_E2E_SLOW_DELAY_MS`（fixture 设为 110ms）
  - 其他 → 立即返回 `Side answer: <question>`
- `options.purpose === 'session-title'` → `E2E Session`
- 其他 → `Main answer accepted. The main conversation is seeded.`

文本流 chunk 顺序：

```
block-start(index 0, text)
text-delta ...            // 每个 token 一个
block-end(index 0, {type:'text', text})
usage
finish({kind:'stop'})
```

abort 时 yield `finish({kind:'aborted', failure:{message, code}})`，不要在 abort 后继续 delta。

## 环境变量

- `DSH_E2E_TOOL_PATH`：`[tool]` 尝试 touch 的文件；测试断言它不存在。
- `DSH_E2E_SLOW_DELAY_MS`：慢流间隔；Host fixture 设为 110ms，脚本自身 fallback 为 90ms。

## 扩展

- 新增行为用新的问题标记（如 `[error]`），并同步 `e2e/specs/`。
- 保持确定性：不要 random、不要真实网络、不要读用户 profile。
- 不要在此包引入 `@deepseek-ai/dsh-llm` 运行时 import；duck typing 是刻意的。
- 改 provider/model 名时同步 `e2e/support/host.ts` 的 `agent-default-model` patch 和 spec。
- 这是一个测试 fixture，不是产品 provider；不要把它打包进 `lib/` 或发布。

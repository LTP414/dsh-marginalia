# tests/ — Vitest 单测与装配测试

本目录只放 Node 环境的 Vitest 测试；浏览器/DOM 行为由 `../e2e/` 的 Playwright 套件负责。测试不启动真实 Host、不调用真实模型、不依赖用户 profile。

## 运行

```bash
npm test                 # vitest run
npm run test:watch       # watch
npm run test:coverage    # v8 coverage, reports to coverage/
```

配置在 `../vitest.config.ts`：`include: tests/**/*.test.ts`，`environment: node`，`testTimeout: 10_000`，coverage include `src/**/*.{ts,tsx}`。

## 文件地图

| 文件 | 覆盖对象 |
| --- | --- |
| `shared.test.ts` | 协议校验、`commandLine`、`buildPrompt`/`formatHistory`、引用围栏、partial/open tools、答案/错误清洗、UTF-8 截断、标题/摘要 |
| `random.test.ts` | `randomId` 的 `randomUUID`/`getRandomValues`/抛错/无 crypto fallback，v4 形状与唯一性 |
| `tool-guard.test.ts` | `ChildGuard` owned-only deny、child-scope 只挂一次、release、失败容器 |
| `store.test.ts` | Host `BtwStore`：parent 隔离、排序、按 key 串行、崩溃修复、memory fallback、删除 |
| `engine.test.ts` | `BtwEngine`：early accept、prompt 内容、follow-up 重放、busy、cancel partial、timeout、archive hook、dispose interrupted |
| `commands.test.ts` | `hideInternalCommands`、`quietInternalCommands`、`registerBtwCommands` 的 JSON/错误结果 |
| `host-wiring.test.ts` | 真实 `apply()` 与 fake Host services 的装配：命令注册、激活参数、guard、stream capture、完成落库、archive、清理 |
| `client-store.test.ts` | Client 状态机：streaming、inherited turn 过滤、canonical finalize、Host rejection、本地 busy、history、dismiss-before-accept、cancel-before-accept、subagent |
| `client-apply.test.ts` | 真实 Client `apply()` 在模拟非安全 origin 下的装配；`/btw` claim 能到 Host bridge |
| `trigger.test.ts` | slash source candidate、claim、参数路由、attachment/subagent 拒绝 |

## 测试工具模式

### `host-wiring.test.ts`

构造 fake `Context`：`logger`、`effect`、`on`、`tools.guard`、`commands.register/list`、`subagents`、`storageDomain`、`workspaceRegistry`；`apply(ctx)` 后直接拿注册的 command handler 调用，并手动 resolve activation result。适合验证入口装配，而不是引擎细节。

### `engine.test.ts`

用真实 `BtwStore`（fake domain table）+ fake `startChild`：

- `makeStarter()` 返回可手动 resolve 的 `ChildHandle`，并在 signal abort 时 resolve `aborted`。
- `waitFor(predicate)` 轮询 store 状态；避免固定 sleep。
- 断言 `fake.requests` 里的 prompt/maxTokens/parent，以及 `fake.disposed`。
- 测试内每次 `engine.dispose()` + `store.close()`，避免悬挂 timer/写链。

### `client-store.test.ts`

`makeHarness()` 提供 fake `Bridge`、`SessionsLike`、`ConversationLike`、session snapshot、chat target、`setChat`/`setChatNodes`/`finishSession`。`uuid`、`now` 固定，便于断言。`bridge.call` 按命令名返回 accepted/topic/list；需要 race 时传入自定义 `options.ask`。

## 修改规则

- 新增行为先加/改对应单测；纯 UI 行为放 e2e，不要为了 jsdom 引入额外依赖。
- 不要用固定 `setTimeout(500)` 等待异步状态；用 `waitFor`/`expect.poll`。
- 不要在测试里读写 `~/.dsh` 或真实 profile；用 fake context/table。
- 改协议/限制时同步 `shared.test.ts`；改生命周期/清理时同步 `engine.test.ts`；改命令静默/隐藏时同步 `commands.test.ts` 与 `host-wiring.test.ts`。
- 当前基线（0.2.0）：10 个文件、53 个测试。加测试后更新 README/`docs/verification.md` 中的数字。

## 与 e2e 的分工

- 单测：纯逻辑、协议、状态机、错误分支、装配、并发/取消的确定性时序。
- e2e：真实 DOM、Lexical composer、slash menu、真实 Host/鉴权/fork、流式、刷新、工具 guard、非安全 origin。
- 不要用单测重复 e2e 已经覆盖的整条浏览器路径；也不要用 e2e 调试纯函数。

# src/host/ — Host 引擎、存储、只读保护

本目录实现 `/btw` 的 Host 侧：fork 子会话、执行期只读、主题持久化、流式 partial 捕获，以及给 Client 用的隐藏命令。入口装配在 `../index.ts`，共享协议在 `../shared.ts`。

## 文件地图

| 文件 | 职责 |
| --- | --- |
| `engine.ts` | 任务生命周期：ask / startChild / settle / cancel / delete / dispose；并发、超时、取消、状态落库 |
| `store.ts` | `storage.domain` 持久化；topic schema；内存 fallback；崩溃修复；按 key 串行写 |
| `tool-guard.ts` | `ChildGuard`：预登记 child id；root + child-scope 执行期 deny |
| `parent-context.ts` | `StreamCapture`（父/子 partial）+ `lastCompletedTurn` + `openTurnSnapshot` / `openToolNames` |
| `commands.ts` | 注册 `btw-ask/list/get/cancel/delete`；从 slash 目录隐藏；静默命令生命周期 |

## 一条 `/btw` 的 Host 时序

```
Client /btw-ask {turnId, question, topicId?, reference?, locale}
  parseAskRequest
  one-active-per-parent / 全局并发 / tombstone 检查
  读取或创建 topic，推入 running turn，store.put
  预留 childId = turnId，ChildGuard.own(childId)
  组装 prompt（历史 + open-turn 快照 + 实时 partial + reference）
  ctx.subagents.startActivation({
    provider: 'fork',
    childId,
    request: { parent, prompt: [{type:'text', text}], agentOptions: { maxTokens } },
    delivery: 'caller'
  })
  返回 { topic, turn, baselineTurn }
  后台 settle:
    await activation.result
    capture 到的 partial / result text
    complete / cancelled / error
    updateTurn -> store.put
    guard.release -> activation.dispose -> archiveChild
    active.delete
```

`startActivation` 在 initial prompt 被接受时 resolve，**不要**等完整回答再返回；否则 Client 只能显示 spinner。

## `engine.ts` 关键约束

- **一个 parent session 同时只能有一个 active job**：`active: Map<parentSessionId, ActiveJob>`；第二次 `/btw` 返回 `BtwBusyError`，不排队。
- **全局并发** `MAX_ACTIVE_BTW = 4`；超限返回 `BtwCapacityError`。
- **child id 预分配**：Client 生成 `turnId`，Host 用它作为 childId；`ChildGuard.own(turnId)` 必须发生在 `startActivation` 之前。
- **prompt 只追加，不改前缀**：不传 `persona`/`agentPreset`/`toolFilter`，不碰 system，不注册/移除工具。`maxTokens = min(32k, parent.options.maxTokens)`。
- **baselineTurn**：`lastCompletedTurn(parent.session)` 随 acceptance 返回；Client 用它过滤 fork 继承的父轮次。
- **取消 tombstone**：`cancel` 可能先于 `ask` 到达；`cancelledTurns` 记录 turnId（5 分钟），晚到的 ask 直接拒绝，避免复活已关闭气泡。
- **状态映射**：
  - completed + 有文本 → `complete`
  - completed 无文本 → `error` (`The model returned no text.`)
  - aborted 且用户取消 → `cancelled`（保留 partial/result text）
  - timeout → `error` (`The side question timed out.`)
  - plugin dispose → `interrupted`
  - max-tokens/refusal/error → `error` + `diagnostic`
- **清理顺序**：落库 → release guard → `bounded(handle.dispose(), 5s)` → `bounded(archiveChild, 5s)` → 删 active → resolve job.done。`dispose()` 等待 in-flight `starting`，避免启动晚到后写已关闭 store。
- **archive best-effort**：`workspaceRegistry.archiveSession(childId)`；失败只 log，不影响历史。
- `ChildResult.output` 只取 `type === 'text'`；`sanitizeAnswer` 在 `shared.ts`。

## `store.ts` 关键约束

- Domain：`name: 'marginalia'`，version `1`，表 `topics`，key `${parentSessionId}:${topicId}`，value 是完整 `BtwTopic` JSON。
- 使用 `@deepseek-ai/dsh-storage-domain` 的 `DomainSpec` 结构（跨 zod 副本做了类型 cast）；schema 在文件内定义。
- `BtwStore.open(ctx)`：
  - `ctx.get('storageDomain')` 存在 → `open(spec)`；
  - 打开失败 → memory fallback（`mode: 'memory'`），记录 warning；
  - 打开成功但 `markInterrupted()` 失败 → 仍保持 storage，不降级。
- `markInterrupted()`：启动时把所有 `running` turn 改成 `interrupted`；绝不自动重发。
- `enqueue(key, op)`：按 topic key 串行化 read-modify-write；`put/delete/markInterrupted` 都走它。
- `list(parent)`：只匹配 key 前缀，且校验 `topic.parentSessionId`；按 `updatedAt` 降序。
- `close()`：等待写链，再关 domain；关闭后 `put` 抛错。
- 不要把历史改成全局单 JSON；不要绕过 domain 直接写 `~/.dsh`。

## `tool-guard.ts`

- `owned: Set<childId>`：ask 开始前 `own`，settle/失败时 `release`。
- `check(execution)`：如果 `execution.agent.id` 在 owned 中，返回 `BTW_TOOL_DENIED`；否则 undefined。
- `attach(agent)`：在 `agent/created` 时再挂一次 child-scope guard（纵深防御）；只对 owned id、只挂一次、失败静默。
- root guard 在 `src/index.ts` 注册；这是全局兜底。不要用 `toolFilter` 或 persona 实现只读。
- guard 拒绝所有工具，包括 `send_message`。

## `parent-context.ts`

- `StreamCapture.observe(sessionId, frame)`：
  - `start` 清空该 session 的 partial；
  - `chunk` 只追加 `text-delta`；
  - `end` 保留最后文本（父会话 idle 时不使用，running 时读取）。
  - 最多跟踪 64 个 session，按 LRU 淘汰。
- `partialOf(sessionId)` 返回 trim 后非空文本。
- `lastCompletedTurn(session)`：扫描 `turn/end` 且 `reason.kind === 'completed'`，返回最大 turn；用于 fork baseline。
- `openTurnSnapshot(session)`：从最后一个 `turn/end` 之后取当前 open turn，输出当前 user request、最新 assistant 文本、最近 3 个工具调用/结果和 step；上限 `MAX_PARENT_PROGRESS_CHARS`（6k），不包含已完成轮次、时间戳或随机 ID。直接 user message 才计入任务，注入的 runtime/AGENTS 上下文跳过。
- `openToolNames(session)`：仅在快照没有可读事件时兜底，返回已 `tool/call` 未 `tool/result` 的工具名（最多 5 个）。

## `commands.ts`

- 命令名：`ASK_COMMAND`、`LIST_COMMAND`、`GET_COMMAND`、`CANCEL_COMMAND`、`DELETE_COMMAND`（在 `shared.ts` 定义）。
- 所有命令 `recordInput: false`，不带 `input` descriptor；参数是 JSON，返回 `{kind:'success', text: JSON.stringify(...)}` 或 `{kind:'error', text}`。
- `hideInternalCommands(commands)`：包装 `commands.list`，从 slash 目录过滤内部命令；保留 `find/execute` 供 RPC 使用。恢复时若已有别的 wrapper，则不覆盖。
- `quietInternalCommands(commands)`：包装 `commands.appendLifecycle`：
  - `command/run` 且 name 是内部命令 → 记录 commandId，丢弃；
  - `command/done` 且 commandId 命中 → 丢弃；
  - 其他命令原样透传。
  - 目的：不产生 Chat command 节点，不把 `btw-get` JSON 写进 session log。**这是实例方法兼容垫片**；`appendLifecycle` 不存在时调用 `onUnsupported` 并回退为可见生命周期。
- 命令结果仍通过已鉴权 `remote.commands.execute` 返回；不是原生 Remote。

## 修改指南

- 改并发/超时/状态：`engine.ts` + `tests/engine.test.ts`；同步 `AGENTS.md` 与验证文档。
- 改存储/schema/修复：`store.ts` + `tests/store.test.ts`；注意 version bump 与旧记录兼容。
- 改只读保护：`tool-guard.ts` + `tests/tool-guard.test.ts` + e2e `btw.spec.ts` 的 `[tool]` 场景；绝不能改为提示词约束。
- 改 prompt 输入（open-turn 快照/partial/history/open tools）：`parent-context.ts` / `shared.ts` + `tests/parent-context.test.ts` / `tests/shared.test.ts` / `tests/engine.test.ts`。
- 改命令传输/隐藏/静默：`commands.ts` + `tests/commands.test.ts` + `tests/host-wiring.test.ts` + e2e 主 transcript 节点数断言。

## 已知脆弱点

- `commands.list` / `commands.appendLifecycle` 是 DSH 实例方法补丁，升级 DSH 可能失效；失效时至少保持功能可用并记录 warning。
- 内部命令仍可被已授权 RPC 客户端直接调用；`hide` 不是授权边界。
- child session 不能真正删除，只能 archive best-effort。

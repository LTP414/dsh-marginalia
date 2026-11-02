# src/client/ — Web Client

本目录是 `/btw` 的浏览器端：slash source、状态机、流式气泡、主题历史、Markdown、样式和 i18n。入口是 `index.tsx`，协议来自 `../shared.ts`。

## 文件地图

| 文件 | 职责 |
| --- | --- |
| `index.tsx` | Client 插件入口：locale、remote bridge、store、trigger、slots、样式、清理 |
| `store.ts` | 核心状态机：bubbles、history、child retain、streaming、finalize、cancel、插入 |
| `trigger.ts` | `/btw` input trigger source：candidate、matchSpace/Enter、claim.submit |
| `Bubble.tsx` | `conversation.input.overlay` 气泡层与单条气泡（复制/插入/追问/停止/折叠） |
| `HistoryOverlay.tsx` | `shell.overlay` 历史面板：列表、详情、重试、删除、追问 |
| `Markdown.tsx` | `react-markdown` + GFM；`skipHtml`、禁用图片、外链安全属性 |
| `Icons.tsx` | 内联 SVG 图标，避免额外图标依赖 |
| `styles.ts` | 全部 `mgl-*` CSS，跟随 DSH theme token |
| `locales.ts` | `zh`/`en` 字典、`TranslateFn`、fallback 插值 |

## `index.tsx`：装配顺序

1. `ctx.effect(() => ctx.locale.register(NS, dictionaries))`，并用 `ctx.locale.bind(NS)` 建 `t`。
2. 构造 `Bridge`：`ctx.remote.commands.execute(sessionId, '/btw-ask ...', [], signal)`，解析 `result.text` JSON。
3. 构造 `MarginaliaStore`，注入 `sessions`、`uiConversation`、`t`、`locale`、`log`。
4. 注册 `inputTriggers.registerSource(createBtwTriggerSource(...))`。
5. 注册 slots：
   - `conversation.input.overlay` → `BubbleLayer`，id `dsh-marginalia-bubbles`，order 25
   - `conversation.input.left` → `HistoryButton`，id `dsh-marginalia-history-button`，order 40
   - `shell.overlay` → `HistoryOverlay`，id `dsh-marginalia-history`，order 30
   - `conversation.chat.commandview` → 5 个内部命令 key 的 `null` renderer（隐藏 command 行）
6. 注入 `<style data-plugin="dsh-marginalia">`。
7. 清理 `store.dispose()`。

`HistoryButton` 在 `store.canAsk(sessionId)` 返回错误时（子代理视图）直接返回 null。

## `store.ts`：状态机

### 快照

`MarginaliaSnapshot = { bubbles, history }` 通过 `useSyncExternalStore` 消费。任何变更必须 `publish()` 新对象，不能原地改。

`Bubble`：`id`（= turnId/childId）、`sessionId`、`topicId`、`question`、`answer`、`status`、`error`、`childId`、`reference`、`collapsed`、`streaming`、时间戳。

`HistoryState`：`open`、`sessionId`、`topics`、`selectedId`、`topic`、`loading`、`loadingTopic`、`error`。

### 公开方法

- `ask(sessionId, question, {topicId?, reference?})`：同步校验并创建 `starting` bubble，返回 id；异步 `runAsk`。本地 busy 检查（同 session 已有 starting/running）会抛错。
- `retry(bubbleId)`：用同 question/topic 新建 turn。
- `cancel(bubbleId)`：加入 `cancelled` tombstone、abort ask、release watcher；starting 阶段只发 `{turnId}`；已接受后发 `{topicId, turnId}`。
- `dismiss(bubbleId)`：运行中先 cancel，随后从 UI 删除。
- `toggleCollapse(bubbleId)`。
- `openHistory(sessionId)` / `refreshHistory()` / `selectTopic(topicId)` / `deleteTopic(topicId)`。
- `retryTurn(sessionId, topicId, question)`：历史详情里的重试。
- `followUp(sessionId, topicId, question)`。
- `canAsk(sessionId)`：读 `sessions.binding(sessionId).session.getSnapshot()`；`subagent` 非空或 removed 时返回错误文案。
- `dispose()`：abort pending/history，release watchers，清空 snapshot。

### `ask` → accepted → watch

`runAsk` 调 `bridge.call(ASK_COMMAND, {turnId, topicId?, question, reference?, locale})`，成功后：

- 如果 `cancelled.has(id)` 或 bubble 已不存在 → 发 `btw-cancel`，不复活。
- 更新 `topicId/childId/status/answer/error`，`mergeTopic`。
- 调 `watch(bubbleId, topicId, childId, accepted.baselineTurn ?? 0)`。

`watch`：

1. `sessions.retain(childId, {source:'dsh-marginalia'})`，最多重试 2 次（350ms）。
2. `reference.binding.session` 订阅 lifecycle；`uiConversation.binding(reference.binding).target('chat')` 订阅流式快照。Chat target 不可用则只靠 session idle + GET 回读。
3. `check()` 读取 chat snapshot，过滤 `node.turn <= baselineTurn`，拼接 assistant text + `legacy.partial`。
4. session `running === false` 且 (openState open/error 或有 text) → `finalize()`。
5. `finalize()` 调 `btw-get` 取 canonical turn；若仍 running，最多重试 4×600ms；否则用 canonical answer/status/error，release watcher。
6. retain 失败 → `recoverWithoutChild()`：5 次 `btw-get`（700ms 间隔）兜底；仍失败才显示 `error.notAttached`。

**重要**：`baselineTurn` 过滤是必须的。fork 子会话继承父会话已完成轮次；不过滤会把父回答显示进 side bubble（e2e 曾捕获该 bug）。

### 取消与 tombstone

- `cancelled` 集合用于阻止晚到的 ask/cancel 响应复活 bubble。
- `cancel()` 先 `releaseWatcher`，保留已收到的 answer，状态改 `cancelled`。
- 关闭运行中气泡 = cancel；关闭已完成/错误气泡 = 仅移除 UI。
- `deleteTopic` 会 release 该 topic 下所有 watcher。

### 历史合并

`mergeTopic(topic)` 只在 history 面板打开且 session 匹配时更新列表/选中 topic；不额外发 RPC。`openHistory` 才真正 `btw-list`，选中后 `btw-get`。

## `trigger.ts`

- `trigger: '/'`，`name: 'dsh-marginalia'`，`order: -10`，不显示 group title。
- `candidates()`：子代理视图返回 `[]`；否则一行 `{name:'btw', label, description}`。
- `onPick` / `matchSpace('/btw')` / `matchEnter(/^\/btw(?:\s|$)/)` 都返回 claim。
- `claim.submit(args, actx, attachments)`：
  - 有 attachments → `{kind:'error', text: error.attachments}`；
  - `canAsk` 有错误 → 返回错误；
  - 空 args → `void store.openHistory(sessionId)`；
  - 非空 → `store.ask(sessionId, question)`；
  - 同步异常 → 返回 `{kind:'error'}`。
- 不存在同名 Host `/btw` command；不要改回 `commandUi` monkey patch。

## UI

### `Bubble.tsx`

- `BubbleLayer`：`conversation.input.overlay`，过滤当前 session，按 `createdAt` 排序；`position:absolute; bottom:0` 浮在 composer card 上。
- `BubbleCard`：
  - header：问题、复制、插入（`onInsert` → `inputActions.setDraft`）、追问、历史、折叠、停止/关闭。
  - body：引用 details、状态（spinner/status）、Markdown answer、error、重试/关闭、follow-up 表单。
  - 数据钩子：`data-testid="marginalia-bubble"`、`data-testid="marginalia-answer"`、`data-testid="marginalia-insert"`、`data-status`。
- 运行中只显示 stop；cancelled/interrupted 保留 partial；error 显示错误 + retry。

### `HistoryOverlay.tsx`

- 只在 `history.open` 时渲染；`shell.overlay` 的 backdrop 点击关闭，`Esc` capture 关闭。
- 左侧 rail：`btw-list` 结果、选中态、相对时间；顶部 Ask 表单（提交后关闭面板，让 bubble 可见）。
- 右侧 detail：`btw-get` topic、每轮 question/answer/status/time、复制、retry；删除两次确认（第一次变 `Delete?`）。
- 数据钩子：`data-testid="marginalia-history|marginalia-topic|marginalia-turn"`。

### `Markdown.tsx` / `Icons.tsx` / `styles.ts` / `locales.ts`

- Markdown：GFM、`skipHtml`、`disallowedElements={['img']}`、`img: ()=>null`、`a` 加 `target=_blank rel=noreferrer noopener`。
- Icons：只使用内联 SVG，避免额外依赖；`MarginaliaIcon`、Copy/Check/Close/Stop/Chevron/History/Trash/Refresh/Send/Plus。
- styles：全部 `.mgl-*`；主题 token `--dsw-alias-*`；`.mgl-layer` 浮在 composer 上方；历史面板 fixed backdrop；窄屏 760px 以下全屏。
  - `.mgl-send` 必须用 `button-info-fill` + `label-primary-foreground`，不要在深色模式退回白字白底；`:disabled` 保持 `opacity:1` 且 `min-width:max-content`。
  - 历史右栏：`.mgl-detail` 不整体滚动；`.mgl-turns` 是唯一滚动区；`.mgl-history-follow` 固定在底部，不能与后续轮次重叠。
- locales：`NS = 'dsh-marginalia'`，`en`/`zh` 平铺 key，`interpolate` 支持 `{count}`；`fallbackTranslate` 在 locale 未就绪时使用。

## 修改指南

- 改流式/取消/历史：`store.ts` + `tests/client-store.test.ts` + e2e `btw.spec.ts`。
- 改菜单/claim：`trigger.ts` + `tests/trigger.test.ts` + `tests/client-apply.test.ts`。
- 改气泡/历史 UI：对应 `.tsx` + `styles.ts` + e2e 选择器；保留 `data-testid` 钩子。
- 改 slot/入口：`index.tsx`；同时检查 `package.json` 的 `dsh.client.inject` 是否需要新增依赖。
- 改文案：`locales.ts`；不要只改 `locale/*.json`（那是插件管理器元数据）。
- 不要直接操作主 transcript，不要 monkey-patch `commandUi`，不要在没有 `inputActions` 时伪造插入。

## 测试钩子

e2e 依赖的稳定钩子：

- `[data-testid="marginalia-bubble"]` + `data-status`
- `[data-testid="marginalia-answer"]`
- `[data-testid="marginalia-insert"]`
- `[data-testid="marginalia-history-button"]`
- `[data-testid="marginalia-history"]`、`marginalia-topic`、`marginalia-turn`
- 主记录 `[data-slot="conversation.chat.flow"]`、`[data-chat-node-key]`

改样式可以，但不要删除这些钩子或改变 `data-status` 语义。

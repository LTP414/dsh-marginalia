# e2e/support/ — 隔离 Host 与页面 helper

本目录只有两个文件，但它们是整个浏览器套件的基础。

## `host.ts` — 每个 worker 一个隔离 Host

`startE2EHost(options?)` 返回 `E2EHost`：

```ts
{
  tokenUrl, baseUrl, theme, home, profile, workspace, toolPath,
  bindHost, insecure, port, logPath,
  stop(): Promise<void>
}
```

### 启动流程

1. 在 `.e2e-runs/` 下 `mkdtemp` 一个 `host-*` 目录。
2. `DSH_HOME`、`XDG_DATA_HOME`、`XDG_CACHE_HOME`、`XDG_CONFIG_HOME`、`npm_config_cache` 全部指向该目录；`NO_COLOR=1`。
3. `dsh --profile e2e --from-default-profile web --dump-config` 初始化自定义 profile（不会用用户 profile）。
4. `dsh plugin --profile e2e add <repo>` 链接被测插件。
5. 非 real 模式再 `dsh plugin add e2e/fixtures/fake-llm`。
6. 写 `profile/cordis.patch.yml`，覆盖 `agent-default-model` 和 `ui-theme`：
   - fake：`fake/fake-1`
   - real：`DSH_E2E_REAL_PROVIDER` / `DSH_E2E_REAL_MODEL`（默认 `deepseek-official/deepseek-flash`）
   - theme：`preference: light|dark`（worker fixture 从项目名是否含 `dark` 推导，传给 `startE2EHost({theme})`）
7. `seedWorkspace()` 写 `storages/workspace.json`（domain version 2，path 指向 `home/workspace`，`sessionIds: []`）。
8. `freePort()` + 选择绑定地址：`DSH_E2E_BIND_HOST` > 第一个非 loopback IPv4 > `127.0.0.1`。
9. `spawn('dsh', ['--profile','e2e','--no-open','--port',port,'--host',bindHost])`。
10. `waitForUrl()` 从 stdout/stderr 匹配 `dsh web: https?://...`，同时把所有输出追加到 `host.log`。
11. 返回 host；`stop()` 发 SIGTERM，8s 后 SIGKILL。

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `DSH_BIN` | `dsh` 可执行文件，默认 `dsh` |
| `DSH_E2E_BIND_HOST` | 覆盖绑定地址；设 `127.0.0.1` 会让非 secure spec skip |
| `DSH_E2E_SLOW_DELAY_MS` | fake LLM `[slow]` 的 token 间隔，默认 110ms |
| `DSH_E2E_TOOL_PATH` | fake `[tool]` 尝试 `touch` 的文件；默认 workspace 下 `tool-guard-target.txt` |
| `DSH_E2E_REAL*` | real nightly 的 provider/model |
| `DEEPSEEK_API_KEY` | real nightly 的凭据（由 test skip 检查） |

### 注意

- 必须使用真实 launch token；不要加 `--no-auth` 或修改 Host/Origin fence。
- `seedWorkspace` 依赖 DSH 0.2.x 的 workspace domain v2 形状；升级 DSH 时需复核。
- `waitForUrl` 正则只接受 `http(s)://`，不要改回 `\S+`（启动还会打印“listening on ...”行）。
- 每个 worker 独立目录；`stop()` 不删除目录，便于失败诊断。清理由 `.gitignore` 忽略。
- 不要在此文件里 import `@playwright/test`；host 启动是纯 Node 逻辑。

## `ui.ts` — 页面操作契约

### 选择器

- `composer(page)`：`getByRole('textbox', { name: /Describe what you want|Message or run a task|Type a message/i })`。
  - 空白 session 的 aria-label 是 "Describe what you want to build..."，有历史后是 "Message or run a task..."。
  - 不要用 `.nth(1)` 或 Lexical class；follow-up 的 `textarea` 会抢“最后一个 textbox”。
- `chatFlow(page)`：`[data-slot="conversation.chat.flow"]`
- `chatNodes(page)`：全部 `[data-chat-node-key]`，用于调试/观察。
- `transcriptContentNodes(page)`：只匹配 user/assistant 行；主记录“未新增消息”的断言必须用它，不能比较全部节点（`turn-process`/`turn-tail` 在慢 CI 上会晚一帧出现）。
- `latestBubble(page)`：`getByTestId('marginalia-bubble').last()`。
- `bubbleAnswer(bubble)`：`getByTestId('marginalia-answer')`。
- `historyPanel(page)`：`getByTestId('marginalia-history')`。

### 流程 helper

- `openApp(page, host)`：goto token URL + `resumeApp`。
- `resumeApp(page)`：等 `#root`，若出现 Preview 的 `Continue` 就点，等 composer。reload 后使用它，不要重新走 token。
- `seedMain(page)`：composer 输入固定 seed prompt，Enter，等主记录出现 `Main answer accepted` 和 `Usage`（turn 完成），依赖 fake LLM。这样节点计数基线在慢 CI 上稳定。
- `askSide(page, question)`：
  1. composer `fill('/btw')`
  2. 等 `getByRole('option').filter({hasText:'btw'})`
  3. `Enter` 选候选（进入 claim，不提交）
  4. `expect(input).toContainText('/btw')`
  5. `keyboard.type(question)`（不要 `fill`，会覆盖 claim chip）
  6. `Enter`
  7. 返回最新 bubble
- `openHistory(page)`：点 `marginalia-history-button`，等面板。
- `closeHistory(page)`：`Escape`，等隐藏。
- `waitForBubbleStatus(bubble, status)`：等 `data-status`。

### 修改规则

- 新增 helper 必须复用以上选择器语义；不要引入固定 sleep 作为主等待。
- 不要在 helper 里断言业务文案（除 `seedMain` 的 fake 固定回答）；具体断言放 spec。
- 如果 UI 改了 `data-testid`/`data-status`，同步 `src/client/AGENTS.md`、spec 和本文件。
- 失败时优先看 `.e2e-runs/host-*/host.log` 和 Playwright trace，不要先改等待时间。

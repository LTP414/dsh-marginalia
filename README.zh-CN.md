# dsh-marginalia · 边注

> DeepSeek Harness 的只读旁问：在主对话页边提问，不弄脏主对话。

**Marginalia**（边注／页边批注）就是 oh-my-pi `/btw` 的产品含义：主对话旁边的一则注记，不进入主记录，也不打断主任务。

这个项目是一个 DSH Host + Web Client 插件包，实现了该契约的可用版本：

- **同一场对话**：旁问 fork 当前会话，继承同一系统提示、同一工具表、同一已完成历史。
- **执行期只读**：工具定义保留在请求里以保护 prompt 前缀，但执行期 guard 拒绝所有工具调用；这不是提示词约束。
- **看得到半截回答**：主回答仍在流式生成时发起 `/btw`，已捕获的 partial 文本会作为参考注入旁问。
- **主题与历史**：每问持久化状态与回答；追问会重放该主题，并看到**当前**主会话，而不是打开面板时的冻结快照。
- **流式与取消**：Web Client retain 子会话并渲染 partial；停止时保留已生成内容。
- **不伪造 branch**：DSH 没有公开的 assistant 注入／分支 API；提供“插入输入框”作为安全替代。

## 环境

- DSH `>= 0.2.1-rc.1 < 0.3.0-0`（在 `0.2.1-rc.2` 上验证）
- Node `>= 22`
- 支持纯 HTTP 的局域网 Web GUI：`crypto.randomUUID` 仅限安全上下文，插件会在不可用时退回 `getRandomValues`（最后再退回非加密标识符兜底）。
- 标准 Web profile 自带的 `fork` 子代理 provider 与 `storage-domain`；后者缺失时自动退化为进程内存，不会静默写全局 JSON。
- 浏览器端到端测试需要 `dsh` 在 `PATH`（或设置 `DSH_BIN`）、`pnpm` 与 Playwright Chromium。

## 安装与构建

```bash
npm install
npm run check          # 类型检查 + 53 个单测 + 构建 + 冒烟
npm run test:e2e       # 7 个真实浏览器 spec（隔离 Host + fake LLM）
```

然后用 Harness 的插件管理器安装当前目录，或在 bundle composition 中加入：

```yaml
- insert:
    - id: dsh-marginalia
      name: dsh-marginalia
```

构建产物是自包含的：Host 打包了唯一的运行时依赖 `zod`，Client 打包了 Markdown 渲染器；React 和 Harness 包由宿主模块表提供。

## 使用

| 操作 | 方式 |
| --- | --- |
| 就当前会话旁问 | `/btw 刚才为什么选方案 B？` |
| 打开主题历史 | 不带参数的 `/btw`，或输入框左侧的 Marginalia 按钮 |
| 同一主题追问 | 气泡上的发送按钮，或历史详情里的追问框 |
| 停止生成 | 气泡上的停止按钮；已生成内容保留 |
| 复制 / 插入输入框 / 重试 / 删除 | 气泡、历史轮次或输入框上的按钮 |
| 关闭历史 | `Esc`、关闭按钮，或点击遮罩 |

`/btw` 只接受文字。带图片或文件时提交会被明确拒绝，草稿保留在输入框，不会被静默丢弃。

## 工作原理

```
/btw 问题
  → Client input trigger 认领该行
  → Host btw-ask（已鉴权的 command RPC；生命周期日志已静默）
      预分配 child id → guard 该 id → fork 父会话
      追加一条 user 角色的 <btw> prompt
      持久化 running turn
  → Client retain 子会话并跟随其 Chat target
  → Host 捕获流式文本；取消时把 partial 落库
  → Host 落 complete/cancelled/error；尽力 archive 子会话
```

用户可见的 `/btw` 由 `inputTriggers` 的 slash source 提供，不 monkey-patch 官方命令 UI。气泡使用 `conversation.input.overlay`，历史使用 `shell.overlay`，工具栏按钮使用 `conversation.input.left`。Host 侧兼容垫片会从 slash 菜单隐藏内部命令，并丢弃它们的 `command/run`/`command/done` 生命周期，因此主记录与会话日志保持干净。

完整设计见 [`docs/architecture.md`](docs/architecture.md)，验证范围见 [`docs/verification.md`](docs/verification.md)。

## 数据

- Domain `marginalia`，表 `topics`，key 为 `${parentSessionId}:${topicId}`。
- 每个 turn 只保存可见的问题/回答文本与状态；不保存 reasoning、工具调用参数或结果。
- 启动时把所有 `running` 改成 `interrupted`，绝不自动重发。
- 上限：问题 8k 字符、引用 8k、历史重放 64k、单回答 256 KiB、单会话 50 主题、单主题 200 轮、全局 4 个并发旁问、10 分钟看门狗。

内部命令：`btw-ask`、`btw-list`、`btw-get`、`btw-cancel`、`btw-delete`。它们不在 slash 菜单中出现，会话日志中也已静默，但仍可被已鉴权 RPC 解析。这样复用了现有鉴权通道、避免无鉴权 HTTP；更好的长期方案仍是原生 Remote namespace。静默依赖 `CommandRuntime.appendLifecycle`，若未来 DSH 移除它会记录告警并回退为可见生命周期。

## 安全

- 不注册任何 HTTP 路由；读写全部走已鉴权的 `commands.execute` RPC。
- 旁问子会话无法执行任何工具，包括 `send_message`。
- 回答不渲染原始 HTML、远程图片或未净化扩展。
- Host 错误被压成单行、去控制字符、截断。
- 子代理视图直接拒绝旁问；这是主会话功能。
- 子会话继承父会话的 sandbox/permission；guard 只移除工具执行，不扩大权限。

## 诚实的限制

- **不是真 ephemeral**：本地 fork 会产生 durable 子会话；Workspace registry 可用时完成后尽力 archive，但 Host 无法真正“忘记”它。历史本身在 sidecar domain。
- **不做 branch**：DSH 没有公开 assistant 注入/分支 API，不伪造 oh-my-pi 的 `b`。
- **历史以文本重放**：子代理只能接收一条 user prompt，因此历史放进 `<btw-history>`。要做 role 级重放只能走 direct LLM，会失去系统提示/工具/缓存继承。
- **保护前缀，不承诺命中缓存**：Marginalia 不主动改 system/tools/messages，是否命中由 provider 决定。
- **父会话 partial 是尽力而为**：拿不到就省略，不伪造。
- **archive 是尽力而为**：失败会记日志，旁问历史不受影响。
- **传输仍是 command RPC**：生命周期垫片消除了日志/记录污染，但内部命令仍可被已授权 RPC 客户端直接调用；原生 Remote 尚未实现。
- **子代理视图未纳入浏览器套件**：单测覆盖拒绝与隐藏工具栏；真实 GUI 中进入委托子代理视图未自动化。
- **真实模型验收是 gated**：`real.nightly.spec.ts` 仅在 `DSH_E2E_REAL=1` 且 `DEEPSEEK_API_KEY` 存在时运行。

## 端到端验证

浏览器套件为每个 worker 启动**独立** `DSH_HOME` 与自定义 profile，通过真实 launch-token 换取 cookie，预置 workspace，并用可控 fake LLM 逐 token 输出、abort、强制工具调用。默认绑定非 loopback HTTP 地址，因此真正覆盖非安全上下文的 UUID 路径。

覆盖：slash 菜单 claim、逐 token 增长、Stop 保留 partial + 历史 Cancelled、同主题追问、刷新恢复、只读工具拒绝且文件未变、插入输入框、`crypto.randomUUID === undefined` 的纯 HTTP 场景。

详见 [`docs/e2e.md`](docs/e2e.md)。真实模型验收不在确定性套件里：

```bash
DSH_E2E_REAL=1 DEEPSEEK_API_KEY=... npm run test:e2e:real
```

## 开发

```bash
npm run typecheck
npm test
npm run build
npm run test:coverage
npm run test:e2e
```

目录：

```
src/index.ts            Host 入口与装配
src/shared.ts           协议、限制、prompt、净化
src/host/               engine、存储、guard、流捕获、命令
src/client/             trigger source、store、气泡、历史、样式
tests/                  纯单测与装配测试
e2e/                    隔离 Host、fake LLM、Playwright specs
scripts/                构建与产物冒烟
docs/                   研判、架构、验证、e2e
```

## 许可

Apache-2.0。见 [`LICENSE`](LICENSE)、[`NOTICE`](NOTICE)、[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。设计依据见 [`docs/three-way-analysis.md`](docs/three-way-analysis.md)。

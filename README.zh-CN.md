# dsh-marginalia · 边注

> DeepSeek Harness 的只读旁问：在主对话页边提问，不弄脏主对话。

**Marginalia**（边注／页边批注）就是 oh-my-pi `/btw` 的产品含义：主对话旁边的一则注记，不进入主记录，也不打断主任务。

这个项目是一个 DSH Host + Web Client 插件包，实现了该契约的可用版本：

- **同一场对话**：旁问 fork 当前会话，继承同一系统提示、同一工具表、同一已完成历史。
- **执行期只读**：工具定义保留在请求里以保护 prompt 前缀，但执行期 guard 拒绝所有工具调用；这不是提示词约束。
- **看得到半截回答**：主回答仍在流式生成时发起 `/btw`，已捕获的 partial 文本会作为参考注入旁问。
- **主题与历史**：每问持久化状态与回答；追问会重放该主题，并看到**当前**主会话，而不是打开面板时的冻结快照。
- **流式与取消**：Web Client retain 子会话并渲染 partial；停止时保留已生成内容。
- **不伪造 branch**：DSH 没有公开的 assistant 注入／分支 API，因此 v1 明确不做 `b` 分支。

## 环境

- DSH `>= 0.2.1-rc.1 < 0.3.0-0`（在 `0.2.1-rc.2` 上验证）
- Node `>= 22`
- 支持纯 HTTP 的局域网 Web GUI：`crypto.randomUUID` 仅限安全上下文，插件会在不可用时退回 `getRandomValues`（最后再退回非加密标识符兜底）。
- 标准 Web profile 自带的 `fork` 子代理 provider 与 `storage-domain`；后者缺失时自动退化为进程内存，不会静默写全局 JSON。

## 安装与构建

```bash
npm install
npm run check          # 类型检查 + 50 个单测 + 构建 + 冒烟
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
| 复制 / 重试 / 删除 | 气泡或历史轮次上的按钮 |
| 关闭历史 | `Esc`、关闭按钮，或点击遮罩 |

`/btw` 只接受文字。带图片或文件时提交会被明确拒绝，草稿保留在输入框，不会被静默丢弃。

## 工作原理

```
/btw 问题
  → Client input trigger 认领该行
  → Host btw-ask（已鉴权的 command RPC）
      预分配 child id → guard 该 id → fork 父会话
      追加一条 user 角色的 <btw> prompt
      持久化 running turn
  → Client retain 子会话并跟随其 Chat target
  → Host 捕获流式文本；取消时把 partial 落库
  → Host 落 complete/cancelled/error；尽力 archive 子会话
```

用户可见的 `/btw` 由 `inputTriggers` 的 slash source 提供，不 monkey-patch 官方命令 UI。气泡使用 `conversation.input.overlay`，历史使用 `shell.overlay`，工具栏按钮使用 `conversation.input.left`。Host 侧唯一的补丁是一个只过滤内部命令的 `commands.list` 包装。

完整设计见 [`docs/architecture.md`](docs/architecture.md)，验证范围见 [`docs/verification.md`](docs/verification.md)。

## 数据

- Domain `marginalia`，表 `topics`，key 为 `${parentSessionId}:${topicId}`。
- 每个 turn 只保存可见的问题/回答文本与状态；不保存 reasoning、工具调用参数或结果。
- 启动时把所有 `running` 改成 `interrupted`，绝不自动重发。
- 上限：问题 8k 字符、引用 8k、历史重放 64k、单回答 256 KiB、单会话 50 主题、单主题 200 轮、全局 4 个并发旁问、10 分钟看门狗。

内部命令：`btw-ask`、`btw-list`、`btw-get`、`btw-cancel`、`btw-delete`。它们不在 slash 菜单中出现，但仍可被已鉴权 RPC 解析。命令结果会进入会话的 command 生命周期日志——这是为了复用现有鉴权 RPC、而不是新开无鉴权 HTTP 路由所付出的已知代价；未来可改为原生 Remote namespace。

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
- **command 日志会增长**：内部命令结果会被 Host command runner 记录，这是上述传输方案的已知代价。

## 开发

```bash
npm run typecheck
npm test
npm run build
```

目录：

```
src/index.ts            Host 入口与装配
src/shared.ts           协议、限制、prompt、净化
src/host/               engine、存储、guard、流捕获、命令
src/client/             trigger source、store、气泡、历史、样式
tests/                  纯单测与装配测试
docs/                   研判、架构、验证
```

## 许可

Apache-2.0。见 [`LICENSE`](LICENSE)、[`NOTICE`](NOTICE)、[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。设计依据见 [`docs/three-way-analysis.md`](docs/three-way-analysis.md)。

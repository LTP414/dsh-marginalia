# DSH `/btw` 三仓库研判与融合方案

> **结论先行**
>
> 1. **综合最接近 oh-my-pi `/btw` 的是 `MichengAI/dsh-btw`。** 它复刻的是 `/btw` 的“引擎契约”：同一会话/模型/系统提示/工具表，`fork` 子代理继承上下文，执行期 `tool guard` 保证只读，并专门保护 prompt-cache 前缀。它缺的是“侧边对话层”（多轮、历史、流式、分支），而不是核心语义。
> 2. **`kaieye/dsh-AIR` 最接近“侧边对话”形态**：真正的多轮、原生 transcript、流式、独立取消、停靠面板。但它是 `/side`，不是 oh-my-pi 的只读 `/btw`——工具仍然可用，边界提示只是“建议”。
> 3. **`WLV-ZEDD/dsh-btw` 最接近“悬浮坞 + 历史分页”的表面**，但底层是带截断摘要的独立 LLM 调用，既没有系统提示/工具/cache 继承，也没有 in-flight 上下文，离 oh-my-pi 的 `/btw` 引擎最远。
>
> 若只选一个现有实现：**MichengAI**。若要改造：**以 MichengAI 为底座，吸收 kaieye 的流式/生命周期，采用 oh-my-pi 的 topic/status/prompt 模型，重写 WLV 式的历史 UI**。

分析基于以下固定提交（2026-10-28）；DSH 侧以本机 `0.2.1-rc.2` 的类型定义/README 为准。本文是源码级研判，未在你的 web profile 安装三插件做运行对比；文末“需验证”的点应在目标宿主做 POC。

| 仓库 | 提交 | 代码/测试规模 | 观察 |
| --- | --- | --- | --- |
| `MichengAI/dsh-btw` | `2675621` | `src` 约 2.8k 行，26 个测试文件 | Apache-2.0，活跃，1.1.1 |
| `WLV-ZEDD/dsh-btw` | `2b61263` | `lib` 约 1.3k 行，0 测试 | MIT，1.0.5，2 个 open issues |
| `kaieye/dsh-AIR` | `0639ad5` | `src` 约 5.1k 行，25 个测试文件 | MIT，0.1.2，纯客户端 |
| `can1357/oh-my-pi` | `93a5e2e` | TUI/coding-agent 大型 monorepo | MIT，36.8k stars，参考实现 |

---

## 1. oh-my-pi 的 `/btw` 到底“是什么”

先把参考实现拆成 7 条契约。后面的评分都围绕这 7 条，而不是 UI 像不像。

| # | 契约 | oh-my-pi 的实现证据 |
| --- | --- | --- |
| C1 | **同一会话、同一模型、同一系统提示、同一工具表** | `runEphemeralTurn` 明确“The main turn's tool catalog is sent to preserve the prompt cache”；复用当前 session 的 model/system/history |
| C2 | **上下文包含正在流式生成的半截回答** | 文档：`including partial streaming assistant text`；`runEphemeralTurn` 的 snapshot 包含 in-flight 文本 |
| C3 | **绝不执行工具** | `btw-user.md`：`NEVER use tools.`；`runEphemeralTurn`：工具调用被丢弃，模型被提醒不要调用 |
| C4 | **不写入主 transcript** | 文档：`Saved side questions are not appended to the main transcript or sent as history to unrelated turns` |
| C5 | **独立 topic 历史 + 多轮 follow-up** | 每条记录含 `question/answer/status/createdAt/updatedAt/followUps`；follow-up 把历史按 user/assistant 两条消息重放 |
| C6 | **可取消且保留已生成的部分** | `Esc` 取消，面板状态 `Cancelled`，已收到的文本保留；history 中同样可取消 |
| C7 | **完成后可提升为分支（branch）** | 单轮、主会话 idle、session/leaf 未变时，`b` 把这一问一答提升为主会话分支 |

另外还有两个工程性契约：

- **C8：topic 级持久化与并发控制**。每个 topic 一个 sidecar 文件，带 lease/revision，冲突写入拒绝，崩溃后 `running` 恢复为 `interrupted`。
- **C9：prompt-cache 友好**。同一 topic 的成功 follow-up 复用 conversation key；失败/取消后换新的 transport generation。

> 关键判断：oh-my-pi 的 `/btw` **不是“另起一个模型调用”**，而是“在同一个会话状态上开一条临时 side channel”。这决定了三个 DSH 仓库谁更接近。

---

## 2. 三个仓库的实现解剖

### 2.1 `MichengAI/dsh-btw`：最接近的“引擎复刻”

**架构**

- Host 端注册 `/btw`、内部 `/btw-run`、`/btw-close` 命令。
- `/btw` 的 handler 通过 `ctx.subagents` 的 `fork` provider 启动子代理，子代理继承父会话已完成回合的前缀。
- 子代理执行期挂 `ctx.tools.guard(...)`，除“把答案发回父会话的 `send_message`”外全部拒绝。
- Client 端在 `conversation.input.dock` 渲染独立气泡；气泡在内存里，不写主对话。

关键代码：

- fork + `startActivation` + `maxTokens`：[src/index.ts](/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/src/index.ts:112)
- 一次性任务、取消、并发上限、30 分钟看门狗：[src/server/jobs.ts](/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/src/server/jobs.ts:54)
- 执行期只读 guard：[src/server/tool-guard.ts](/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/src/server/tool-guard.ts:89)
- cache 前缀测试（断言 tools/system/全部历史逐字节一致）：[tests/cache-prefix.test.ts](/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/tests/cache-prefix.test.ts:44)
- 提示词：`/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/src/locales.ts:77`

**它做对了什么**

1. **没有改系统提示、没有 `toolFilter`、没有 `persona`**。这是它最被低估的设计：fork 子代理与主会话的 `tools → system → messages` 前缀逐字节一致，provider 侧 cache 才有机会命中。
2. **只读是执行期硬约束，不是提示词软约束**。`ctx.tools.guard` 是 monotonic guard，模型即使“想调用”也执行不了。
3. **子代理是 fork，不是新 session 的普通副本**。它天然继承父会话的 tool-call/tool-result 历史，模型看到的是“同一场对话”。
4. **任务生命周期完整**：启动、取消、关闭、并发上限、超时、插件卸载、启动失败回滚都写了。
5. **气泡交互完整**：复制、折叠/展开、关闭、取消、Markdown/公式、主题、i18n、划词引用。它甚至处理了“气泡满 20 条先关最旧”的边界。

**它缺什么**

- **没有流式 token**。`SideJobs.ask()` 等子代理完整结果，Client 只看到 spinner；这不是 oh-my-pi 的逐 token 面板。
- **没有历史**。README 明确：刷新后气泡不恢复，每次旁问独立；没有 topic/follow-up/branch。
- **fork 只到最后一个 `turn/end`**。DSH 的 fork provider 明确排除 in-flight turn，所以 oh-my-pi 的 C2（半截回答）做不到；它只能看到已完成内容。
- **子代理 session 可能留下记录**。代码里 `activation.dispose()` 没有显式 `archiveSession`；是否落盘取决于 `sessionPersistence`。UI 不显示历史，但 host 侧可能累积 subagent session/catalog 记录。这是“伪 ephemeral”。
- **`send_message` 例外是双刃剑**。提示词要求“用户明确要求才发回”，但模型有实际工具权限；一旦判断错，就会写主对话。oh-my-pi 是绝不写。
- **Client 端 monkey-patch 了官方 `commandUi`**：`candidates/dispatch/matchSpace/matchEnter/execute` 全部被替换（[src/client/index.tsx:45](/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/src/client/index.tsx:45)）。这是为了把 `/btw` 从“命令”变成“自定义气泡”，但版本升级时最容易坏。
- **子代理目录/lineage 可能出现在 header**。普通 sidebar 会隐藏 subagent，但 header 的 descendant count 仍可能增长。
- **不支持在 subagent 内提问**；也不支持“聚焦子代理作为被问会话”（oh-my-pi 会问 focused subagent）。

**一句话**：它是“DSH 版的 `runEphemeralTurn` + guard”，引擎最像；但侧边产品层只做了 30%。

---

### 2.2 `WLV-ZEDD/dsh-btw`：最像“坞”，最不像“同一场对话”

**架构**

- Host 端只注册 `/btw` 命令；handler 立刻返回，后台调用 `ctx.llm.prepareCall()` 直接生成。
- 自己拼一个 system prompt：时间、workspace、session title、以及“会话历史摘要”。
- 历史摘要把每轮 user/assistant 截断成 100/120 字符；超过 30 轮只保留头 3 + 尾 25。
- Client 每 500ms 轮询 `/api/dsh-btw/feed`，渲染悬浮 banner、量子均衡器、分页、复制/删除/折叠。
- 历史写在 `~/.dsh/storages/btw-history.json`，全局一份，按 `sessionId` 分组。

关键代码：

- 直接 LLM 调用：[lib/index.js:302](/home/kali/Dev/dsh-test/refs/WLV-ZEDD_dsh-btw/lib/index.js:302)
- 会话摘要截断：[lib/index.js:242](/home/kali/Dev/dsh-test/refs/WLV-ZEDD_dsh-btw/lib/index.js:242)
- 自定义 system prompt：[lib/index.js:385](/home/kali/Dev/dsh-test/refs/WLV-ZEDD_dsh-btw/lib/index.js:385)
- 5 次瞬时错误重试：[lib/index.js:411](/home/kali/Dev/dsh-test/refs/WLV-ZEDD_dsh-btw/lib/index.js:411)
- 无鉴权 HTTP 路由：[lib/index.js:521](/home/kali/Dev/dsh-test/refs/WLV-ZEDD_dsh-btw/lib/index.js:521)
- Client 轮询：[lib/client.js:439](/home/kali/Dev/dsh-test/refs/WLV-ZEDD_dsh-btw/lib/client.js:439)

**它做对了什么**

- **零工具风险**：请求里根本没有工具定义，模型不可能执行工具。
- **产品感最好**：输入框上方的浮动坞、实时“thinking/retry”状态、历史分页、Markdown、删除、折叠，是三者里最像“随手一问”的。
- **失败重试**：对 500/502/503/504/rate limit/timeout 做 5 次快速退避，状态徽章可见。
- **实现小**：1.3k 行、无构建，容易改。

**它的问题（按严重度）**

1. **上下文不是同一场对话**。它只把历史压缩成摘要，模型看不到原始 tool-call/tool-result，也看不到精确措辞、代码、文件内容。对“总结刚才方案/解释这个报错”这类 `/btw` 主场景，信息损失是致命的。
2. **没有系统提示/工具/cache 继承**。它换了 system prompt，工具列表为空，provider 侧 prefix cache 基本不可能命中；每问一次都是全量付费。
3. **没有 in-flight 上下文**。主会话正在生成时，它只有上一轮已完成摘要。
4. **没有取消**。只有 feed/ask/delete/models/model/retry 路由；关闭 banner 不会 abort 后台请求，可能继续烧 token。
5. **没有 follow-up**。每条记录独立，没有 topic 概念。
6. **持久化不安全**。全局单 JSON，`readFileSync/writeFileSync`，无原子替换、无锁、无 revision；两个 session 并发写会互相覆盖。历史里还会保留 `loading=true`，进程重启后永远转圈。
7. **HTTP 路由没有按 session 的授权校验**。`/feed?sessionId=` 可读同一 host 上任意 session 的问答；`/ask` 可对任意 `sessionId` 发起请求。即使宿主有全局登录态，也缺少“这个连接是否有权访问这个 session”的边界。这是不应该带进生产的模式。
8. **模型选择/发现靠解析 `settings.yaml`**。正则解析 provider/model 块，宿主配置一变就失效。
9. **自写 Markdown 解析器**。链接、HTML、代码围栏的清洗都要自己负责，长期不如宿主 `MarkdownText`。
10. **轮询而非推送**。500ms 轮询在长回答时浪费请求；且它并不是逐 token 流，服务端只在结束时写答案。

**一句话**：它是“带历史分页的独立旁问聊天框”，不是 oh-my-pi 的 `/btw`。如果只想要一个不执行工具的快速问答坞，它够用；要“基于当前会话精确旁问”，它不合格。

---

### 2.3 `kaieye/dsh-AIR`：最接近“侧边对话”，但它是 `/side`

**架构**

- Host 入口为空（`src/index.ts` 只实现 `apply` 空函数），全部在 Client 端。
- `/btw`（以及 `/side` 别名）通过 `inputTriggers` 注册为 slash source。
- 打开时用 `sessions.fork()` 从父会话最后一个 completed turn 切一个 child；如果没有 completed turn，则 `create()` 一个 child，并把父会话可见 suffix 作为 reference-only 文本注入。
- Child 在右侧 dock 里用原生 `conversation` slot 树渲染：消息、工具、审批、队列、附件、composer 全部复用 Host。
- 后续问题直接走 child 的原生 composer；`/btw` 再次执行会先安全关闭旧 child。
- 关闭流程：drain queue → cancel → 等 quiescent → archive child。

关键代码：

- fork / interrupted child：[src/client/BtwController.ts:255](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/src/client/BtwController.ts:255)
- 关闭与归档：[src/client/BtwController.ts:360](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/src/client/BtwController.ts:360)
- boundary prompt：[src/core/btw-boundary.ts:1](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/src/core/btw-boundary.ts:1)
- 原生 conversation 嵌入：[src/client/BtwNativeConversation.tsx:1](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/src/client/BtwNativeConversation.tsx:1)
- 对齐说明：[docs/btw-alignment.md](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/docs/btw-alignment.md:1)

**它做对了什么**

1. **真正的多轮**。child 有自己的 composer，后续问题保留在同一个 child session 里，role 结构是真实的 user/assistant，不需要把历史压成一段文本。
2. **流式是免费的**。原生 conversation 直接订阅 child snapshot，token、工具、审批、队列都是 Host 现成的。
3. **生命周期的细节最好**：父会话运行/等待审批/失败/中断状态、child 状态、pending 数量、关闭 quiescence、归档失败回滚、不能嵌套 `/btw`、离开父会话时清理。
4. **in-flight 处理比 MichengAI 更接近 oh-my-pi**：它会把父会话未完成的 assistant 文本、running tool calls 作为 reference-only snapshot 注入首条 prompt。虽然形式是文本，但至少 C2 的信息在了。
5. **UI 最“像产品”**：右侧可拖拽 dock、原生 composer、Stop、状态标签、窄屏全宽。

**它的问题**

1. **不是只读**。boundary prompt 明确说“External tools may be available according to this thread's current permissions”，只要求“未经明确要求不要改”。这不是 C3；模型完全可以读文件、跑命令、改代码。它是 `/side`，不是 `/btw`。
2. **没有工具 guard**。它依赖提示词和 child 的权限设置；没有 MichengAI 那种执行期 deny。
3. **不是 ephemeral**。`sessions.fork()`/`create()` 产生的是普通 child session，关闭时 `archiveSession`；Host log 仍然存在，只是被归档。它自己在文档里承认“无法完全对齐 ephemeral fork”。
4. **boundary 是用户消息**。它被拼进首条 prompt，改变了请求尾部；child 是普通 session，系统提示/工具表没有像 MichengAI 那样做逐字节保证，因此 prompt cache 不能作为设计目标。
5. **没有 topic 历史**。关闭 child 就没了；再次 `/btw` 是替换，不是历史列表。没有 follow-up 历史面板、没有 branch。
6. **Client-only 的代价**。没有 host 端 guard、没有跨会话持久化、没有服务端任务所有权；所有能力都压在浏览器和公开 client API 上。
7. **monkey-patch `child.prompt`**。为了隐藏 boundary 并注入首条上下文，它重写了 child 的 `prompt` 方法（[BtwController.ts:624](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/src/client/BtwController.ts:624)）。能用，但版本升级风险高。
8. **body margin hack**。用 `body[data-dsh-air-btw-open] #root { margin-right: ... }` 给 dock 让位，而不是用 DSH 的布局 slot；窄屏/多插件并存时容易打架。
9. **没有历史/分支** 是产品层最大的缺口；它把“side conversation”做深了，但没有做“btw history”。

**一句话**：如果 oh-my-pi 的 `/btw` 被你理解成“侧边多轮对话”，kaieye 最接近；如果按 oh-my-pi 的真实契约（只读、同前缀、ephemeral、历史/branch），它是 `/side`，不是 `/btw`。

---

## 3. 对齐矩阵：谁更接近？

权重按“oh-my-pi `/btw` 语义”而非“UI 好看”设定：

- 上下文/缓存 30%
- 只读 20%
- 隔离/持久化 15%
- 多轮/历史/分支 20%
- 交互/流式/取消 10%
- DSH 适配/工程质量 5%

| 维度 | 权重 | MichengAI | WLV | kaieye |
| --- | ---: | ---: | ---: | ---: |
| C1 同模型/系统/工具/cache | 30% | **9** | 3 | 6 |
| C2 in-flight 半截上下文 | 计入 C1 | 3 | 1 | **8** |
| C3 绝不执行工具 | 20% | **10** | **10** | 2 |
| C4 不写主 transcript | 15% | **8** | 7 | 7 |
| C5 多轮/独立历史 | 10% | 2 | 3 | **8** |
| C6 取消保留部分 | 5% | 4 | 1 | **8** |
| C7 branch | 5% | 0 | 0 | 0 |
| 流式/面板体验 | 10% | 5 | 6 | **9** |
| DSH 原生适配/工程 | 5% | 7 | 4 | 6 |
| **加权总分（10 分制）** | 100% | **7.2** | **5.1** | **5.7** |

> 评分是“相对 oh-my-pi `/btw`”的判断，不是绝对质量分。若把“多轮侧边对话”权重提高到 35%，kaieye 会反超；但那就变成在评 `/side` 了。

**结论**：

- **综合：MichengAI > kaieye > WLV。**
- **只评“侧边多轮对话”：kaieye > MichengAI > WLV。**
- **只评“悬浮坞/历史分页”：WLV 的表面最完整，但引擎最弱。**

---

## 4. 各自的优劣（可直接拿去做选型）

### MichengAI

**优势**

- 唯一同时做到“fork 继承 + 执行期只读 + cache 前缀保护”的实现。
- 生命周期/取消/并发/超时/卸载最完整，测试最多。
- 气泡交互、划词引用、i18n、主题、Markdown 安全降级都考虑了。
- 版本门明确，面向 DSH `0.2.x` 全系列。

**劣势**

- 一次性：没有 topic、follow-up、history、branch。
- 没有 token 流；只有 spinner。
- fork 不含 in-flight 半截回答。
- 子代理 session 可能残留；没有显式 archive。
- `send_message` 例外让“绝不写主对话”不再是硬保证。
- Client monkey-patch 官方 `commandUi`，升级易碎。
- 气泡刷新即丢。

**适合**：想要“正确的只读旁问”，不介意没有历史；或作为二次开发底座。

### WLV

**优势**

- 最简单、最容易改；无工具风险。
- 坞/分页/重试/状态徽章的产品感最好。
- 历史按 session 分组，刷新后还在。

**劣势**

- 上下文摘要截断，丢 tool/精确文本；不满足“基于当前会话”这个核心。
- 无系统提示/工具/cache；每问都是独立全量请求。
- 无取消、无 follow-up、无 branch。
- 全局 JSON 无原子/锁；HTTP 无鉴权；模型发现靠解析 YAML。
- 自写 Markdown 解析器，安全/兼容性要自己扛。
- 无测试。

**适合**：只想快速问一个与当前会话弱相关的问题；或作为 UI 原型。

### kaieye

**优势**

- 真正的多轮侧边对话，原生 transcript/工具/审批/队列/composer 全部复用。
- 流式、Stop、父状态、child 状态、关闭 quiescence、归档回滚都做了。
- in-flight 父上下文快照处理得最好。
- UI 最完整，可拖拽、窄屏适配。

**劣势**

- 工具可用，不是只读；boundary 只是提示词。
- 不是 ephemeral；child 是普通 session，关闭后 archive，但 log 仍在。
- boundary 改请求尾部；child 的系统/工具未做逐字节保证，cache 不能作为设计目标。
- 无 topic 历史、无 branch、无“把答案发回主对话”。
- Client-only，无 host guard/持久化。
- monkey-patch `child.prompt` + body margin hack，升级风险。
- 早期版本（0.1.2），最后更新 2026-08。

**适合**：想要“侧边会话/第二个 agent”而不是“只读旁问”；或作为原生 conversation 嵌入的参考。

---

## 5. 如何有机结合：目标架构

目标不是“把三个仓库拼起来”，而是**以 DSH 的公共能力为骨架，把三者的强项放到正确层**：

```
┌──────────────────────────────────────────────────────────────┐
│ Client (Web)                                                  │
│  /btw input trigger ──► BtwController ──► BtwBubble          │
│                            │                 │                │
│                            │                 ├─ 流式文本       │
│                            │                 ├─ copy/collapse  │
│                            │                 └─ close/cancel   │
│                            ├─ BtwHistoryOverlay (shell.overlay)│
│                            └─ retain child session (live)     │
└────────────────────────────┬─────────────────────────────────┘
                             │ internal command / remote
┌────────────────────────────▼─────────────────────────────────┐
│ Host                                                          │
│  BtwEngine                                                    │
│   ├─ one active job per parent session                        │
│   ├─ fork child @ current completed prefix                    │
│   ├─ tool guard (deny all; optional send_message to parent)   │
│   ├─ prompt builder (<btw> + side history + parent partial)   │
│   ├─ status/cancel/cleanup                                    │
│   └─ BtwStore (storage.domain, per parent session)            │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 设计原则

1. **引擎用 fork，不用直接 LLM 调用。** 只有 fork 能同时拿到相同 system/tools/历史、DSH 的重试/压缩/secret obfuscation/权限管线。
2. **只读用 guard，不用 toolFilter/persona。** 任何改变工具表或系统提示的做法都会破坏 cache 前缀；guard 是执行期 deny，不改请求。
3. **所有 BTW 指令放在 user message，不放 system。** 这样 prefix 不变，只追加尾部；prompt 里明确“工具定义只是为了前缀一致，调用会被拒绝”。
4. **一问一 child，child 用完即弃；历史放 sidecar。** 这样每次都能看到“当前”父会话，而不是打开侧栏时的冻结快照；同时避免 child 历史污染。
5. **UI 用 DSH 公共 slot，不 monkey-patch 官方内部对象。** 气泡用 `conversation.input.overlay`，历史用 `shell.overlay`，入口用 `inputTriggers`。
6. **不伪造 DSH 没有的能力。** 没有 ephemeral fork、没有 assistant 注入、没有 branch，就明确降级，不假装。

### 5.2 组件来源表

| 组件 | 采用谁 | 说明 |
| --- | --- | --- |
| Fork 子代理 + `startActivation` | MichengAI | 已验证 `fork` 继承 + 取消/清理 |
| 执行期 tool guard | MichengAI | 直接复用 `createAnswerOnlyGuard` 思路 |
| cache 前缀保护 | MichengAI | 不改 system/tools；测试断言逐字节一致 |
| `<btw>` prompt + NEVER tools | oh-my-pi | 语义最准，短而明确 |
| topic/turn/status 数据模型 | oh-my-pi | `running/complete/cancelled/error/interrupted` + `followUps` |
| 流式/取消/生命周期 | kaieye | 保留 child session 订阅 + cancel/quiescence |
| 历史列表/分页/状态徽章 | WLV + oh-my-pi | WLV 的“可见状态”，oh-my-pi 的 topic 结构 |
| 气泡 UI | MichengAI | 复制/折叠/关闭/Markdown/主题 |
| 历史详情 + follow-up | oh-my-pi | 列表 + 详情 + 输入框，不用 WLV 的单条分页 |
| 存储 | 新写 | `ctx.storage.domain`，不沿用 WLV 全局 JSON |
| 回传主对话 | MichengAI 的 `send_message`（可选） | 默认关闭；UI 显式按钮，不让模型自行决定 |
| branch | 暂不做 | 见 §7 |

### 5.3 一次 `/btw` 的时序

```
User: /btw 刚才为什么选方案 B？
  │
  ├─ Client: 生成 turnId/childId；插入 pending bubble（status=running）
  │
  ├─ Client → Host: /btw-run {turnId, childId, question, topicId?}
  │
  ├─ Host: 校验（空/长度/同 session 是否已有 running）
  │    ├─ 有 → 返回 BTW_BUSY（oh-my-pi 也是拒绝，不排队）
  │    └─ 无 → 创建 job
  │
  ├─ Host: 取父会话 completed prefix + 可选 in-flight partial
  │        构造 <btw> prompt（含同 topic 历史）
  │
  ├─ Host: 预登记 childId → startActivation(fork, delivery=caller)
  │        子代理一创建就挂 guard；模型请求的 tools/system 与父会话一致
  │
  ├─ Host → Client: accepted（childId/baselineSeq）
  │
  ├─ Client: sessions.retain({parentSessionId, childSessionId, mode:'continuable'})
  │        订阅 child snapshot；只渲染 baselineSeq 之后的节点/partial
  │
  ├─ Child: 生成答案（工具调用被 guard 拒绝）
  │
  ├─ Host: 结果落地 → 写 BtwStore（complete/error/cancelled）
  │        可选 archive child；保留到 bubble 关闭再归档
  │
  └─ Client: 气泡从 running → complete；可复制/折叠/关闭/追问
```

关键点：

- **命令返回要早**：`startActivation` 在 initial prompt 被接受时就 resolve，不要等完整答案；否则 Client 只能 spinner。
- **Client 先 retain 再等 accepted** 会 race；用 `childId` 预分配 + `retain().ready` 重试/回退轮询。
- **同 topic 的 follow-up 也是新 child**：用当前父会话 + 之前的 side turns 重新构造 prompt。这样父会话推进后，follow-up 仍能看到最新上下文（oh-my-pi 的“current, not frozen”）。

### 5.4 数据模型

```ts
type BtwStatus = 'running' | 'complete' | 'cancelled' | 'error' | 'interrupted'

interface BtwTurn {
  id: string                 // turnId，也用作 childId
  question: string
  answer: string             // 仅可见文本；不存 reasoning/tool payload
  status: BtwStatus
  error?: string
  createdAt: number
  updatedAt: number
  childSessionId?: string
  baselineSeq?: number
  model?: { provider: string; model: string }
}

interface BtwTopic {
  id: string
  parentSessionId: string
  title?: string             // 默认首问截断
  createdAt: number
  updatedAt: number
  turns: BtwTurn[]           // turns[0] 是 topic root，其余是 follow-up
}
```

存储建议：

- `ctx.storage.domain` 定义 `btw` domain，表 `topics`，key = `${parentSessionId}:${topicId}`，value = 完整 topic JSON。
- 启动时把 `running` 改成 `interrupted`；不要自动重发。
- 删除 topic 时只删 sidecar，不动主 session。
- parent session 删除/归档时级联清理（监听 session 删除事件，或按 TTL 清理）。
- 单 session 最多 50 topics / 200 turns；单 turn 答案上限（如 256KB）防止异常。

如果没有 `storage.domain`，fallback 到 `~/.dsh/storages/btw/<sessionId>.json`，但必须：

- 用临时文件 + rename 原子替换；
- 每 session 一个写队列；
- 带 revision，拒绝覆盖更新的写入；
- 不做全局单文件。

### 5.5 Prompt 与上下文

推荐 prompt（保持短，和 oh-my-pi 一致）：

```text
<btw>
Ephemeral side question for the current interactive session.
Answer briefly and directly from the conversation context already provided.
NEVER use tools.
NEVER ask follow-up questions.

Tool definitions inherited from the main session exist only to keep the request
prefix identical; any tool call is rejected. Answer in plain text or Markdown,
in the same language as the question.

[If this is a follow-up, replay the topic's previous turns here as reference.]
<btw-history>
User: ...
Assistant: ...
User: ...
Assistant: ...
</btw-history>

[Optional, if the parent turn is still streaming:]
<parent-in-progress>
...partial assistant text captured when /btw was invoked...
</parent-in-progress>

Question:
{{question}}
</btw>
```

注意：

- **不要**把这段放进 system prompt；不要新增 system section。
- **不要**为了“更安全”而改 tool 列表；guard 在执行期拒绝。
- **不要**给 child 传 `persona`/`agentPreset`/`toolFilter`。
- 如果父会话正在流式生成，fork seed 不包含它；从 `agent/assistant-stream` 的 buffer 里取最近文本，作为 reference-only 文本注入。拿不到就省略，不要伪造。
- 如果父会话有未完成的 tool call，把“正在调用 X”写进 `<parent-in-progress>`；不要执行它。
- 子代理 `maxTokens` 取 `min(32k, parentMaxTokens)`（MichengAI 的做法），避免“继承历史 + 大输出预算”把上下文撑爆。这个改动不影响 prefix。

### 5.6 流式与 UI

**推荐 UI 布局**

- 气泡：`conversation.input.overlay`，而不是 `conversation.input.dock`。前者是“composer 内的浮动层”，天然在输入框上方/内部，不会把主会话顶开；后者会参与布局，多个插件容易抢高度。
- 历史：`shell.overlay` 的全屏/居中面板；列表 + 详情两栏，窄屏单栏。
- 入口：`inputTriggers.registerSource` 注册 `/btw`、`/side`；这比 MichengAI 的 `commandUi` monkey-patch 稳。
- 可选“展开为侧边对话”：在 `sidebar.right` 用原生 conversation 渲染当前 child（借鉴 kaieye），但这是增强，不是 v1 必需。

**流式来源**

优先级：

1. **保留 child session**：`sessions.retain({parentSessionId, childSessionId, mode:'continuable'})`，订阅 `getSnapshot()`，渲染 `nodes`（seq > baseline）和 `partial`。这是最 DSH-native 的方式。
2. **Host SSE/HTTP 流**：如果 child retain 不可用，服务端把 child 的 `agent/assistant-stream` 转成 SSE；需要鉴权，不要学 WLV 的裸路由。
3. **250ms 轮询**：最后兜底；只返回增量文本和状态，不返回全量历史。

**气泡状态**

- `running`：spinner/细进度条 + “Answering…”；不要用夸张的均衡器，oh-my-pi 是克制的。
- `complete`：Markdown、copy、collapse、close、follow-up。
- `cancelled`：保留已生成文本，状态 “Cancelled”；再按 Esc/关闭才移除。
- `error`：单行清洗后的错误 + retry 按钮（点击重发，不自动重试）。
- `interrupted`：页面重载/宿主崩溃后恢复；只读，不自动重发。

**键盘**

- Web 没有 TUI 的 `f/b/c` 全局键；在气泡聚焦时提供：
  - `c` copy（可选）
  - `f` focus follow-up
  - `Esc` 取消/关闭（运行中先取消，再关闭）
- 历史面板：`Up/Down` 选 topic，`Enter` 追问，`c` 复制，`Delete` 删除，`Esc` 关闭。

### 5.7 取消、关闭、并发

- **一个 parent session 同时只允许一个 running**；第二次 `/btw` 返回 `BTW_BUSY`，不排队（对齐 oh-my-pi 的“refuse while any BTW request is running”）。
- **关闭运行中的气泡 = 取消**：abort child，等待 quiescence，把已生成文本写入 history，状态 `cancelled`。
- **关闭已完成气泡 = 仅移除 UI**：history 仍保留。
- **插件卸载/父 session 归档**：abort 所有 job，等待 cleanup，释放 guard，archive child。
- **关闭先于启动完成**：用 requestId tombstone（MichengAI 的 `retired` 思路），防止晚到的启动复活。
- **清理超时**：5s 上限；超时不要假装成功，保留 error 状态供用户重试。

### 5.8 历史与 follow-up

- `/btw` 无参数 → 打开 `shell.overlay` 历史，默认选中最新 topic。
- `/btw <q>` → 新建 topic（或若用户从历史里选了一个 topic 再输入，则是 follow-up）。
- 气泡上的 “Follow up” → 在气泡内展开一个小输入框；提交后创建新的 turn，topic 不变。
- Follow-up prompt 重放该 topic 的**所有** turns（含 cancelled 的部分答案），再加上当前父会话上下文。
- 历史详情显示每个 turn 的 question/answer/status/time；cancelled 显示部分答案；error 显示错误；interrupted 只读。
- 删除 topic：只删 sidecar；如果对应 child 还 resident，先 cancel/archive。
- 刷新后：从 sidecar 恢复；所有 `running` 变 `interrupted`；不自动重发。

### 5.9 回传主对话 / branch

**oh-my-pi 的 branch 在 DSH 没有公开等价 API。** `sessions.fork()` 是“复制一个 session”，不是“把一条 assistant 消息插入当前 transcript”。因此：

- **v1 不做 branch**，不要伪造。
- 提供两个明确的替代：
  1. **插入到输入框**（推荐）：把答案作为引用/文本插入 composer，用户自己决定发送；不写 transcript，不触发模型。
  2. **发送到主对话**（可选）：调用 `send_message` 或 `agent.followup`，需要用户点击确认；这会写主 transcript，和 oh-my-pi 的“不自动写”不同，所以默认关闭。
- MichengAI 的 `send_message` 例外可以保留为“显式回传”功能，但建议改成 **UI 按钮触发**，而不是让模型在 prompt 里自行判断。模型自行判断会带来不可预测的主对话污染。
- 如果未来 DSH 暴露“在指定 leaf 注入 assistant 消息/创建 branch”的 API，再实现真正的 `b` 分支。

### 5.10 安全与 DSH 适配

- **不要**注册无鉴权的 HTTP 路由。若必须用 HTTP/SSE：
  - 只允许同源；
  - 每个连接/ session 一个随机 token；
  - 服务端从 token 解析 session，不接受任意 `sessionId`；
  - 限制 body 大小、问题长度、并发数。
- **Markdown**：优先宿主 `MarkdownText`（MichengAI 的 `loadHostMarkdownText`），fallback 用 `react-markdown` + `skipHtml`，禁止远程图片。不要用 WLV 的自写 parser。
- **错误**：单行、去控制字符、截断；不要把 provider 原始错误/路径/密钥直接展示。
- **输入**：问题 8k 字符、引用 8k、topic 总历史 64k；超限明确报错，不静默截断。
- **权限**：child 继承父会话的 sandbox/permission；guard 只保证“不执行”，不改变权限模型。
- **版本**：`dsh >=0.2.0-rc.1 <0.3.0-0`；feature detect `startActivation`/`subagents`/`storage.domain`/`conversation.input.overlay`；缺能力时给出可读错误，不崩宿主。
- **清理**：child archive、guard release、listener off、AbortController、timer unref；插件 dispose 要幂等。

### 5.11 落地阶段

**P0：把 MichengAI 变成“正确的底座”（1–2 天）**

- fork 现有仓库，保留 `jobs.ts` / `tool-guard.ts` / `limits.ts` / `shared.ts`。
- 把 Client 的 `commandUi` monkey-patch 换成 `inputTriggers` source。
- 把气泡从 `conversation.input.dock` 移到 `conversation.input.overlay`。
- 加 `BtwStore`（先用内存 + JSON fallback），支持 topic/turn/status。
- 加 `shell.overlay` 历史列表（只读 + 复制 + 删除）。
- 所有 `/btw` 仍是 one-shot；follow-up 先不做。

**P1：流式 + 取消保留 + follow-up（3–5 天）**

- Host 改为“命令立即返回 + 后台 job”；Client 预分配 `childId` 并 `sessions.retain`。
- 渲染 child snapshot 的 `partial` 与 baseline 之后的节点。
- 关闭运行中气泡 → cancel → 保存 partial → `cancelled`。
- Follow-up：新 child + 重放 topic turns；UI 气泡内输入框。
- 历史 `running` → `interrupted` 恢复逻辑。

**P2：in-flight 父上下文 + 清理（2–3 天）**

- 订阅父 `agent/assistant-stream`，缓存最近文本；`/btw` 时注入 `<parent-in-progress>`。
- child 完成后 archive（或关闭气泡后 archive）；避免 subagent catalog 膨胀。**注意**：`workspaces.archiveSession()` 对 subagent child 的可行性需在目标 DSH 版本验证；若不可，退化为 `dispose()` + sidecar 清理，并在文档中说明。
- 可选：`send_message` 回传按钮（默认关闭）。
- 可选：右侧原生 conversation 展开（借 kaieye）。

**P3：branch/多客户端/打磨**

- 研究 DSH 是否出现 assistant 注入/branch API；没有就保持“不伪造”。
- 多 tab 并发：job token + storage revision。
- i18n、主题、键盘、窄屏、可访问性。

### 5.12 验收标准

1. **上下文**：mock LLM 断言 `/btw` 请求的 `tools`、system、已完成 messages 与父会话最近一次请求逐字节一致（直接复用 MichengAI 的 `cache-prefix.test.ts`）。
2. **只读**：注册一个会写文件的危险工具，mock 模型强制调用；断言 guard 拒绝、文件未变、最终仍有文字回答或明确错误。
3. **不污染主对话**：`/btw` 前后父 session 的 `snapshotEvents()` 只多出 `command/run`/`command/done`（`recordInput:false`），没有 user/assistant 消息。
4. **流式**：Client 在 200ms 内看到第一个 partial 文本；不是等最终结果才出现。
5. **取消**：运行中关闭，child 停止，history 中保留部分答案，状态 `cancelled`，主会话不受影响。
6. **历史**：刷新后 topic/turn 恢复；`running` 变 `interrupted`；不自动重发。
7. **follow-up**：第二个 turn 的请求包含第一个 turn 的 Q/A，同时包含父会话最新内容。
8. **并发**：同 session 第二个 `/btw` 返回 busy；不同 session 可并行。
9. **清理**：插件 dispose 后无 timer/listener/child 残留；child archive 成功或给出可重试错误。
10. **安全**：没有无鉴权 HTTP；Markdown 不执行 HTML/远程图片；错误不泄露密钥/路径。

---

## 6. 无法完全对齐 oh-my-pi 的点（要诚实）

| oh-my-pi 行为 | DSH 约束 | 建议降级 |
| --- | --- | --- |
| 真 ephemeral side turn，不产生 session | DSH 的 fork 子代理是 durable subagent；没有 ephemeral fork | 用完 archive（需验证 subagent child 可 archive）；历史放 sidecar；文档写明不是零痕迹 |
| 上下文包含 in-flight assistant 文本 | fork seed 只到最后一个 `turn/end` | 从 `agent/assistant-stream` 取文本，作为 `<parent-in-progress>` 注入；拿不到就省略 |
| follow-up 以独立 user/assistant 消息重放 | 子代理只能接收一条 user prompt，不能注入 assistant | v1 把历史压成 `<btw-history>` 文本；若必须 role 级重放，只能走 direct LLM（会丢 cache/系统提示/工具） |
| branch `b` 提升答案 | 没有公开的 assistant 注入/branch API；`sessions.fork` 不是这个语义 | 不做 branch；提供“插入输入框”/显式回传 |
| focused subagent 作为被问会话 | `/btw` 在 subagent 视图的可用性取决于宿主命令/trigger | 先只支持顶层 session；或显式检测并拒绝 |
| TUI 的 `c/f/b/Esc` 键位 | Web 焦点在 composer/气泡，Host 会抢键 | 用气泡内按钮 + 局部快捷键；不要全局劫持 |
| prompt cache 一定命中 | DSH 仍需 provider 支持；child session 的 system 可能因 subagent 组合略有差异 | 用测试断言前缀；不承诺一定命中，只承诺“不主动破坏” |

---

## 7. 最终建议

### 如果只选一个现成插件

- **要正确性/只读/上下文**：选 **MichengAI/dsh-btw**。
- **要侧边多轮对话**：选 **kaieye/dsh-AIR**，但要接受“它能工具执行、不是只读”。
- **要一个轻量悬浮问答坞**：选 **WLV-ZEDD/dsh-btw**，但不要期待它理解当前会话的细节。

### 如果要做“最贴近 oh-my-pi 的 DSH 版”

**以 MichengAI 为底座**，按以下顺序改造：

1. 保留它的 fork + guard + cache 前缀 + 任务生命周期——这是最难复刻、也最值钱的部分。
2. 用 `inputTriggers` + `conversation.input.overlay` + `shell.overlay` 替换它的 `commandUi` monkey-patch 和 dock，降低升级风险。
3. 加 oh-my-pi 的 topic/turn/status/follow-up 数据模型，历史放 `storage.domain`，不要全局 JSON。
4. 用 child session retain 做流式；取消时保留 partial；刷新把 running 恢复为 interrupted。
5. 每次提问/追问都新开 fork child（当前父上下文），历史以 `<btw-history>` 重放；不要用长期 child 冻结上下文。
6. 不做假 branch；用“插入输入框”作为安全回传，`send_message` 只做显式可选项。
7. 最后再考虑把 kaieye 的原生 conversation 作为“展开侧栏”增强，而不是主路径。

这样得到的组合是：

- **MichengAI 的引擎正确性**（同前缀、只读、生命周期）
- **kaieye 的流式/取消/侧栏体验**
- **oh-my-pi 的 topic/status/prompt/历史语义**
- **WLV 的“坞”产品感**（但去掉摘要上下文、全局 JSON、裸 HTTP）

---

## 8. 参考

- oh-my-pi `/btw` 文档：[docs/slash-command-internals.md#L315](/home/kali/Dev/dsh-test/refs/can1357_oh-my-pi/docs/slash-command-internals.md:315)
- oh-my-pi ephemeral turn：[agent-session.ts#L12549](/home/kali/Dev/dsh-test/refs/can1357_oh-my-pi/packages/coding-agent/src/session/agent-session.ts:12549)
- oh-my-pi prompt：[btw-user.md](/home/kali/Dev/dsh-test/refs/can1357_oh-my-pi/packages/coding-agent/src/prompts/system/btw-user.md:1)
- oh-my-pi turn/history：[btw-turn.ts](/home/kali/Dev/dsh-test/refs/can1357_oh-my-pi/packages/coding-agent/src/session/btw-turn.ts:1)、[btw-history.ts](/home/kali/Dev/dsh-test/refs/can1357_oh-my-pi/packages/coding-agent/src/session/btw-history.ts:1)
- DSH fork 语义（只到 completed turn、one-time snapshot）：[dsh-subagent-fork-in-process/README.md](/home/kali/Soft/deepseek-harness/node_modules/@deepseek-ai/dsh-subagent-fork-in-process/README.md:12)
- DSH guard 语义：[dsh-tools/README.md](/home/kali/Soft/deepseek-harness/node_modules/@deepseek-ai/dsh-tools/README.md:89)
- DSH prefix cache 语义：[dsh-agent-loop/README.md](/home/kali/Soft/deepseek-harness/node_modules/@deepseek-ai/dsh-agent-loop/README.md:164)
- MichengAI 关键实现：[src/index.ts](/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/src/index.ts:112)、[tool-guard.ts](/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/src/server/tool-guard.ts:89)、[cache-prefix.test.ts](/home/kali/Dev/dsh-test/refs/MichengAI_dsh-btw/tests/cache-prefix.test.ts:44)
- WLV 关键实现：[lib/index.js](/home/kali/Dev/dsh-test/refs/WLV-ZEDD_dsh-btw/lib/index.js:302)、[lib/client.js](/home/kali/Dev/dsh-test/refs/WLV-ZEDD_dsh-btw/lib/client.js:439)
- kaieye 关键实现：[BtwController.ts](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/src/client/BtwController.ts:255)、[btw-boundary.ts](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/src/core/btw-boundary.ts:1)、[btw-alignment.md](/home/kali/Dev/dsh-test/refs/kaieye_dsh-AIR/docs/btw-alignment.md:1)

### 许可提示

- MichengAI：Apache-2.0；作为底座时保留 `LICENSE`/`NOTICE`，修改文件加说明。
- WLV、kaieye、oh-my-pi：MIT；移植代码/提示词时保留版权与许可声明。Apache-2.0 项目可以包含 MIT 代码，但要在 NOTICE/third-party 中标注。

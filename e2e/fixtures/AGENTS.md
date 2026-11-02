# e2e/fixtures/ — Playwright fixture 与模型包

## `dsh.ts`

导出 `test`、`expect` 和 `MarginaliaFixtures`。

- `host` 是 **worker-scoped** fixture：每个 Playwright worker 只启动一次 Host，所有 test 复用它但各自使用新 browser context/空白 session。
- 主题由 `workerInfo.project.name` 是否包含 `dark` 决定；dark 项目通过真实 `ui-theme.preference=dark` 启动 Host，不用 `colorScheme` 模拟。
- `timeout: 180_000`：启动包含 profile 初始化 + 两次 `dsh plugin add` + Host 启动。
- `finally { await host.stop() }`：即使测试失败也停止 Host；run 目录保留供诊断。
- 日志只打印脱敏后的 `host tokenUrl`（`token=***`）和 `home` 路径。
- 不要在 fixture 里做页面操作；页面 helper 在 `../support/ui.ts`。

## `fake-llm/`

一个独立的本地 bundle package：

- `package.json`：`dsh-e2e-fake-llm`，`dsh.bundle.patch` 指向 `cordis.patch.yml`。
- `cordis.patch.yml`：插入 `e2e-fake-llm` 行。
- `index.js`：注册 duck-typed `fake` adapter。

它只在隔离 profile 中通过 `dsh plugin add` 链接；不会被发布，也不在 `package.json` 的 `files` 中。详细行为见 `fake-llm/AGENTS.md`。

## 规则

- 不把真实 provider 或网络依赖放进 fake-llm。
- 不把 user `~/.dsh` 路径写死；所有路径从 `host.home` / `host.workspace` 派生。
- 改 fixture 签名时同步 `specs/` 和 `support/ui.ts`。
- `host` fixture 是 worker 级：不要在 test 内手动 `startE2EHost`（real nightly 例外，它使用 base test）。

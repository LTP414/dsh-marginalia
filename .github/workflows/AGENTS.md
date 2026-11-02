# .github/workflows/ — 具体 workflow

## `ci.yml`

触发：push 到 `main`、任意 PR。

- 矩阵 Node `22` 与 `24`，`fail-fast: false`。
- `actions/checkout` → `setup-node`（npm cache）→ `npm ci` → `npm run check`。
- `npm run check` = typecheck + 53 Vitest + build + built-artifact smoke。
- 不启动浏览器、不启动 DSH Host、不需要凭据。

## `e2e.yml`

触发：`workflow_dispatch`、每日 `0 18 * * *` UTC。

- `setup-node` Node 24 + npm cache。
- `npm ci`。
- 全局安装 `pnpm@11` 与 `@deepseek-ai/dsh@0.2.1-rc.2`（e2e fixture 的 `dsh`/`pnpm` 依赖）。
- `npx playwright install --with-deps chromium`。
- `npm run test:e2e`（脚本先 build）。
- 失败时上传 `.e2e-runs/artifacts` 和 `.e2e-runs/host-*/host.log`。

## 修改规则

- 改 Node/DSH 版本时四处同步：`package.json engines`、devDependencies、`e2e.yml` 安装版本、`docs/verification.md`。
- 不要让 e2e workflow 触碰用户 `~/.dsh`；fixture 自己创建 `.e2e-runs`。
- 失败上传路径要与 `playwright.config.ts` 的 `outputDir`、host fixture 的日志路径一致。
- 不要给 `ci.yml` 加 `secrets` 依赖；它必须能在 fork PR 上运行。
- 新增 workflow 时在 `../AGENTS.md` 加一行导航。

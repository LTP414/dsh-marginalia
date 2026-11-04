# .github/ — CI 配置

## 文件

- `.github/workflows/ci.yml`：每次 push 到 main / PR 的单元检查。
- `.github/workflows/e2e.yml`：新 tag（`v*`）+ 手动触发的真实浏览器套件。
- 详细 workflow 说明见 `workflows/AGENTS.md`。

## 关联命令

- `ci.yml` 执行 `npm ci` + `npm run check`，矩阵 Node 22/24。
- `e2e.yml` 安装 `pnpm@11` 和 `@deepseek-ai/dsh@0.2.1-rc.2`，安装 Chromium + Firefox，执行 `npm run test:e2e`，失败上传隐藏目录 `.e2e-runs/artifacts` 与 `host.log`（`include-hidden-files: true`）。
- 不在每次 push/PR 跑浏览器套件：单元 CI 已覆盖快速反馈；e2e 只做发布/tag 验收，避免每天消耗 Runner 分钟。

## 修改规则

- 保持单元 CI 与浏览器 CI 分离；不要在每个 push 跑完整浏览器套件。
- 不要为了让 CI 通过而关闭鉴权、跳过失败 spec 或删除断言；应修复根因或明确标注 gated/nightly。
- 真实 provider 不进默认 CI；它需要 `DEEPSEEK_API_KEY`，只放 nightly/手动。
- 更新 DSH 版本时同步 `package.json` 的 `engines.dsh`、devDependencies、`e2e.yml` 的全局安装版本和 `docs/verification.md`。
- 不提交 token、API key、`.npmrc` 凭据。

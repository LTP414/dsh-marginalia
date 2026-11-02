# e2e/ — 真实浏览器验收

本目录是 `dsh-marginalia` 的 Playwright 套件：**真实 Web GUI + 真实隔离 Host + 确定性 fake LLM**。它不是单元测试的替代，而是覆盖单测无法证明的部分：slash menu、Lexical composer、真实 fork、流式、刷新、工具 guard、非安全 origin。

## 目录

```
e2e/
  support/host.ts     每个 worker 启动/停止隔离 Host
  support/ui.ts       页面打开、composer、/btw、bubble、history 等 helper
  fixtures/dsh.ts     worker-scoped Playwright fixture
  fixtures/fake-llm/  确定性 LLM bundle（独立 package）
  specs/btw.spec.ts          7 条核心浏览器 spec
  specs/history-theme.spec.ts 深色主题历史面板回归（Chromium/Firefox dark）
  specs/screens.spec.ts       README 截图生成（仅 E2E_SCREENSHOTS=1 + screens project）
  specs/real.nightly.spec.ts 真实 provider，默认 skip
```

配置文件是根目录的 `playwright.config.ts`；模型/插件都通过隔离 profile 加载。

## 关键设计

- **隔离**：每个 worker 自己的 `DSH_HOME`、profile、端口、workspace、storage；不碰 `~/.dsh/profiles/web`。
- **真实鉴权**：导航 Host 打印的 `?token=...` URL，换取 `dsh-auth-*` cookie；没有关闭鉴权，没有伪造 owner peer。
- **真实 Host**：`dsh --profile e2e`，`dsh plugin add` 链接当前插件；workspace domain 预置。
- **非安全 origin**：默认绑定第一个非 loopback IPv4（如 `10.10.0.2`），使 `crypto.randomUUID` 为 undefined；可用 `DSH_E2E_BIND_HOST` 覆盖。若只有 loopback，对应 spec 会 skip。
- **浏览器矩阵**：`chromium` / `firefox` 跑 7 条核心 spec；`chromium-dark` / `firefox-dark` 只跑深色历史回归，Host 通过 `ui-theme.preference=dark` 启动。
- **确定性模型**：`fixtures/fake-llm` 注册 `fake/fake-1`，逐 token 输出、`[slow]` 延迟、`[tool]` 强制 bash 工具调用、abort 终止。
- **等待策略**：Playwright web-first assertions / `expect.poll`；禁止用固定 sleep 作为主要等待。
- **失败产物**：trace + screenshot 保留；video 关闭（需要匹配的 Playwright ffmpeg）。

## 运行

```bash
npm run test:e2e          # build + 全部 spec
npx playwright test -g "Stop keeps"   # 单条
npm run test:e2e:headed   # 有头调试
npm run test:e2e:real     # DSH_E2E_REAL=1 + DEEPSEEK_API_KEY，nightly
```

前置：

- `dsh` 在 `PATH`（或 `DSH_BIN`），版本符合 `engines.dsh`
- `pnpm` 在 `PATH`（Host 的 plugin add 使用）
- Playwright Chromium + Firefox；配置会自动探测 `~/.cache/ms-playwright` 或仓库 `.playwright-browsers`，否则 `npx playwright install chromium firefox`

运行产物在 `.e2e-runs/`（已 gitignore）：`host-*/`、`host-*/host.log`、`artifacts/`。完整矩阵是 16 passed + 2 个 nightly skip（每个 light 项目各一个）。

README 截图：`npm run screenshots`（`E2E_SCREENSHOTS=1` + `screens` project），写入 `docs/assets/screenshots/`。

## 必须保持的契约

1. **不要复用用户 profile**；所有状态在 `.e2e-runs/`。
2. **不要关闭鉴权**来绕过 401；token URL 是唯一登录方式。
3. **fake LLM 不联网**；行为由 prompt 标记控制，保持确定性。
4. **每个 spec 独立**：新 browser context 默认打开空白 session；不要依赖前一个测试的 bubble/history。
5. **选择器**：优先 `getByRole` / `getByTestId` / `data-chat-node-key`；不要依赖 Lexical 内部 class。
6. **等待**：`expect(...)` / `expect.poll`；`page.waitForTimeout` 只用于观察流式采样，不作为成功条件。
7. **非 secure origin**：修改 Host 绑定方式时确认 `host.insecure` 与 `crypto.randomUUID` 断言仍成立。
8. **深色模式**：不要用 `colorScheme` 模拟，必须通过隔离 profile 的 `ui-theme.preference=dark`，否则测不到 DSH token。

## 子目录

- `support/AGENTS.md`：Host 生命周期、环境变量、登录、UI helper。
- `specs/AGENTS.md`：spec 列表、fake prompt 标记、断言重点。
- `fixtures/AGENTS.md`：worker fixture、fake-llm 包。
- `fixtures/fake-llm/AGENTS.md`：adapter 契约、chunk 形状、扩展方式。

## 与 CI

`.github/workflows/e2e.yml` 在 `workflow_dispatch` 和每日 schedule 上运行；安装 DSH/pnpm/Chromium + Firefox 后执行 `npm run test:e2e`，失败上传 `.e2e-runs/artifacts` 和 host 日志。单元 CI 不跑浏览器套件。

# AGENTS.md — dsh-marginalia

本文件是仓库级入口。这里只介绍背景、项目定位和目录导航；具体代码、架构与修改约束见各子目录的 `AGENTS.md`。

## 背景

`dsh-marginalia` 是 DeepSeek Harness（DSH）的 Host + Web Client 插件包，版本 `0.2.1`，Apache-2.0。

它实现 oh-my-pi 风格的 `/btw`：在主对话旁边问一个**只读**的侧问题，回答留在“页边”，不进入主 transcript。项目名取自 `marginalia`（页边注）。

## 项目定位

- `/btw <question>`：fork 当前主会话，继承同一 system prompt、工具表与已完成历史；旁问子会话不执行任何工具。
- 主题历史：问题/回答/状态持久化到 `storage.domain`，支持追问、停止、重试、删除。
- Web UI：`conversation.input.overlay` 气泡、`shell.overlay` 历史面板、`conversation.input.left` 入口；流式、取消保留 partial、插入输入框。
- 传输：隐藏的已鉴权 command RPC；生命周期日志已静默，避免污染主记录。

## 核心边界（阅读代码前先记住）

1. 不改 system prompt、不改工具表、不重写继承消息——只追加一条 user prompt，保护 fork 前缀。
2. 只读靠执行期 `tools.guard`，不是提示词；子会话不能调用任何工具。
3. 不写主 transcript；旁问历史放 sidecar domain。
4. fork 会继承父会话已完成轮次，Client 必须用 `baselineTurn` 过滤，不能把父回答显示进气泡。
5. 浏览器测试使用隔离 `DSH_HOME`，绝不碰用户的 `web` profile。

## 目录导航

| 目录 / 文件 | 子级 AGENTS.md | 职责 |
| --- | --- | --- |
| `src/` | [src/AGENTS.md](src/AGENTS.md) | 源码入口与同构共享模块 |
| `src/host/` | [src/host/AGENTS.md](src/host/AGENTS.md) | Host 引擎、存储、只读 guard、流捕获、内部命令 |
| `src/client/` | [src/client/AGENTS.md](src/client/AGENTS.md) | Web Client：trigger、store、气泡、历史、样式、i18n |
| `tests/` | [tests/AGENTS.md](tests/AGENTS.md) | Vitest 单测与装配测试 |
| `e2e/` | [e2e/AGENTS.md](e2e/AGENTS.md) | Playwright 真实浏览器 + 隔离 Host + fake LLM |
| `e2e/support/` | [e2e/support/AGENTS.md](e2e/support/AGENTS.md) | 隔离 Host 启动、登录、UI helper |
| `e2e/specs/` | [e2e/specs/AGENTS.md](e2e/specs/AGENTS.md) | 浏览器验收场景 |
| `e2e/fixtures/` | [e2e/fixtures/AGENTS.md](e2e/fixtures/AGENTS.md) | Playwright fixture 与 fake-llm 包 |
| `e2e/fixtures/fake-llm/` | [e2e/fixtures/fake-llm/AGENTS.md](e2e/fixtures/fake-llm/AGENTS.md) | 确定性 fake LLM bundle |
| `docs/` | [docs/AGENTS.md](docs/AGENTS.md) | 研判、架构、e2e、验证报告 |
| `scripts/` | [scripts/AGENTS.md](scripts/AGENTS.md) | 构建与产物冒烟 |
| `assets/` | [assets/AGENTS.md](assets/AGENTS.md) | bundle 图标 |
| `locale/` | [locale/AGENTS.md](locale/AGENTS.md) | 插件管理器的显示元数据 |
| `.github/` | [.github/AGENTS.md](.github/AGENTS.md) | CI 与 e2e 工作流 |
| `.github/workflows/` | [.github/workflows/AGENTS.md](.github/workflows/AGENTS.md) | 具体 workflow 文件 |

### 根目录其他文件

- `package.json`：包名、版本、`dsh` bundle/client 声明、scripts、devDependencies。
- `cordis.patch.yml`：bundle 插入行。
- `tsconfig.json` / `tsconfig.build.json`：类型检查与声明输出。
- `vitest.config.ts` / `playwright.config.ts`：单测与浏览器测试配置。
- `README.md` / `README.zh-CN.md`：用户向说明。
- `CHANGELOG.md`、`LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`：发布与许可。
- `lib/`、`node_modules/`、`coverage/`、`.e2e-runs/`：生成物或依赖，禁止手改。

## 按任务找入口

| 任务 | 先读 |
| --- | --- |
| 改 fork、guard、任务生命周期、存储 | [src/host/AGENTS.md](src/host/AGENTS.md) |
| 改 `/btw` 菜单、气泡、流式、历史面板 | [src/client/AGENTS.md](src/client/AGENTS.md) |
| 改 prompt、协议、限制、ID、错误清洗 | [src/AGENTS.md](src/AGENTS.md) |
| 加单测 | [tests/AGENTS.md](tests/AGENTS.md) |
| 加浏览器验收 | [e2e/AGENTS.md](e2e/AGENTS.md)、[e2e/specs/AGENTS.md](e2e/specs/AGENTS.md) |
| 改构建产物/冒烟 | [scripts/AGENTS.md](scripts/AGENTS.md) |
| 改 CI | [.github/AGENTS.md](.github/AGENTS.md) |
| 改文档/验证结论 | [docs/AGENTS.md](docs/AGENTS.md) |

## 常用命令

```bash
npm run check          # typecheck + 53 unit tests + build + built-artifact smoke
npm run test:coverage  # unit suite with coverage
npm run test:e2e       # Chromium + Firefox + dark projects; 16 passed, 2 nightly skipped
npm run test:e2e:real  # nightly only: DSH_E2E_REAL=1 + DEEPSEEK_API_KEY
```

浏览器套件需要 `dsh` 在 `PATH`（或 `DSH_BIN`）以及 Playwright Chromium + Firefox；它会创建 `.e2e-runs/` 下的隔离环境。不要为了让测试通过而关闭鉴权或改用户 profile。

## 约定

- 修改行为时同步更新对应子目录的 `AGENTS.md`、测试和验证文档。
- 保持 `lib/` 为构建产物；不要直接编辑。
- 不要把真实模型依赖放进确定性单测/e2e；真实 provider 只放 nightly。
- 读一个子目录的 `AGENTS.md` 后，再读该目录的关键文件，不要只依赖本文件。

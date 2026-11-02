# scripts/ — 构建与产物冒烟

本目录只有两个 Node ESM 脚本，均不参与 TypeScript 编译；它们由 `package.json` 的 scripts 调用。

## `build.mjs`

由 `npm run build` / `prepack` 调用，产出：

- `lib/index.js`：Host bundle，`platform: node`、ESM、`bundle: true`、`target: node22`。所有 `@deepseek-ai/*` 都是 type-only，唯一打包的运行时依赖是 `zod`。
- `lib/client.js`：Client bundle，`platform: browser`、CJS、`target: es2022`、`jsx: automatic`。`react` / `react/jsx-runtime` / `react-dom` external；Markdown 等打包进来。用 `window.__ModuleLoader__.load({id: pkg.name, factory: ...})` 包装，`return module.exports` 结束。
- `lib/types/**`：`tsc --project tsconfig.build.json` 生成声明。

### 修改注意

- 不要在 Client bundle 中 externalize `@deepseek-ai/*` 运行时包；Client 只应依赖 React 模块表。
- 不要移除 `banner`/`footer`；DSH Web 通过 `__ModuleLoader__` 加载。
- 如果新增运行时依赖，确认 Host 是打包进去，Client 是打包还是 external；React 必须 external。
- 不要提交/手改 `lib/`；它是 `.gitignore` 生成物。发布前 `npm run build`。
- TypeScript 声明使用 `tsconfig.build.json`（只含 `src`），不要让它把 `tests/e2e` 带入产物。

## `smoke.mjs`

由 `npm run smoke` 调用，必须在 `npm run build` 之后。它做三件事：

1. 以 ESM import 构建后的 Host，断言 `name`、`apply`、`inject`。
2. 用 `globalThis.window.__ModuleLoader__` stub + DOM shim 加载构建后的 Client，断言导出和 inject。
3. 在模拟“纯 HTTP、无 `crypto.randomUUID`”的环境下调用构建后 Client 的 `apply()`，执行真实 `/btw` claim，到达 `btw-ask`，并确认没有 UUID 错误。

这是构建/打包层面的保护网；它不替代 `test:e2e`。

### 修改注意

- 改 `package.json` 的 bundle/client 入口、inject 列表或模块包装时，同步 smoke 的断言。
- 不要从 `src/` 直接 import；smoke 只验证 `lib/` 产物。
- 保持脚本无网络、无用户 profile 访问。
- 如果新增顶层 DOM 依赖，smoke 的 `document` stub 需要补；否则只会在真实浏览器暴露。

## 运行

```bash
npm run build
npm run smoke
npm run check   # typecheck + unit + build + smoke
```

不要在脚本中使用绝对用户路径；输出目录相对仓库根。

# docs/assets/ — README 视觉资源

这里放 README 使用的本地图片，避免依赖外链徽章或截图托管。

## 文件

- `lang-zh.svg` / `lang-en.svg`：README 右上角的语言切换按钮（本地 SVG，无外链）。
- `screenshots/`：Playwright 生成的功能截图，详见 `screenshots/AGENTS.md`。

## 规则

- 图片路径必须相对仓库根，README 中直接引用 `docs/assets/...`。
- 不引用远程图片/徽章；不在截图里放 token、API key、用户路径。
- SVG 保持小体积、无脚本、无外部字体；颜色使用品牌蓝 `#2f81f7`。
- 修改截图后同步 `README.md` 与 `README.zh-CN.md` 的 alt/说明文字。
- 生成脚本在 `e2e/specs/screens.spec.ts`，命令为 `npm run screenshots`。

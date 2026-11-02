# assets/ — bundle 视觉资源

## `icon.svg`

- 36×36 SVG，用于 DSH 插件管理器/bundle 显示。
- 图形：页边注/页面 + 火花；渐变 `#7C3AED → #2563EB`，强调色 `#FBBF24 → #FB7185`。
- 许可：项目原创，随项目 Apache-2.0；不要引入未授权的第三方图标。

## 修改规则

- 保持 36×36 viewBox、可缩放、无外部资源/字体/脚本。
- 不要用位图替换 SVG；不要引用远程 URL。
- 改图标后检查 `package.json` 的 `files` 仍包含 `assets/icon.svg`，并在插件管理器/README 中确认显示。
- 不要在此目录放截图、banner、测试产物；截图属于文档/发布资源，当前项目未使用。

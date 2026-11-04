# assets/ — bundle 视觉资源

## `icon.svg`

- 36×36 SVG，用于 DSH 插件管理器/bundle 显示。
- 图形：页边注/页面 + 火花；渐变 `#7C3AED → #2563EB`，强调色 `#FBBF24 → #FB7185`。
- 许可：项目原创，随项目 Apache-2.0；不要引入未授权的第三方图标。

## `icon-512.png`

- 512×512 PNG，仅用于 awesome-dsh-plugin 市场卡片；仓库条目 `data/plugins/LTP414__dsh-btw-marginalia.yml` 通过 `icon:` 引用它。
- 由 `icon.svg` 的纯色导出栅格化，正方形、透明背景；不要用它替换 `icon.svg`。

## 修改规则

- 保持 36×36 viewBox、可缩放、无外部资源/字体/脚本。
- 不要用位图替换 `icon.svg`；市场卡片位图单独维护。
- 改图标后检查 `package.json` 的 `files` 包含 `assets/icon.svg` 与 `assets/icon-512.png`，并在插件管理器/市场卡片中确认显示。
- 不要在此目录放截图、banner、测试产物；截图属于文档/发布资源，当前项目未使用。

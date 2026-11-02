# docs/assets/screenshots/ — README 功能截图

四张由 Playwright 生成的截图：

| 文件 | 场景 |
| --- | --- |
| `btw-menu.png` | 真实 slash 菜单中的 `/btw` 候选 |
| `btw-streaming.png` | 旁注气泡流式输出中（Stop 可见） |
| `btw-history.png` | DSH 浅色主题下的两轮主题历史 |
| `btw-history-dark.png` | DSH 深色主题下的两轮主题历史 |

## 生成

```bash
npm run screenshots
```

- 使用 `e2e/specs/screens.spec.ts` 与隔离 Host；不碰用户 profile。
- 截图模式写入 `DSH_E2E_DEMO=1`，fake LLM 返回面向演示的固定文本，模型标签显示 `Marginalia Demo`。
- 浅色 Host 来自截图 project；深色 Host 在 spec 内以 `theme: 'dark'` 启动。
- `animations: 'disabled'` 防止 backdrop 淡入被截成半透明；`caret: 'hide'` 去掉光标。
- 截图尺寸：菜单/流式为 1280×720，历史面板为 982×674。

## 规则

- 不要手改 PNG；改 spec 或 demo 文案后重新生成。
- 截图不能包含预览弹窗、token、浏览器地址栏或用户路径。
- 如果 UI 的 `data-testid`/布局变化，先更新 `src/client/AGENTS.md` 与 spec。
- 语言切换徽章在 `../lang-*.svg`，不是截图。

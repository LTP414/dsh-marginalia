# locale/ — 插件管理器显示元数据

这里只有 `en.json` 和 `zh.json`，用于 DSH bundle/插件管理器的**显示**（标题、描述），不是运行时 UI 文案。

## 结构

```json
{
  "meta": {
    "title": "Marginalia",
    "description": "Read-only side questions ..."
  }
}
```

- 文件名是语言 id（`en`、`zh`），由 DSH 的 bundle 显示层读取。
- 只保留 `meta.title` / `meta.description`；不要在这里加 UI key。

## 与 `src/client/locales.ts` 的区别

| 文件 | 用途 |
| --- | --- |
| `locale/en.json`、`locale/zh.json` | 插件安装/管理界面的包标题与描述 |
| `src/client/locales.ts` | Web UI 运行时文案（菜单、气泡、历史、错误），通过 `ctx.locale` 注册 |

改 UI 文案只改 `src/client/locales.ts`；改插件管理器里的标题/描述才改这里。

## 修改规则

- JSON 必须合法；两个语言文件保持一致的结构。
- 标题简短；描述一句话说明“只读旁问 + 不改主记录”。
- 不要在 locale 文件里写密钥、用户路径或版本号。
- 新增语言需同时确认 DSH 的语言 id 与 `package.json` 的 `files` 包含 `locale`。

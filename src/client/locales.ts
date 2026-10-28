/** Client copy for Marginalia. Keep keys flat so the DSH locale binder can interpolate `{name}`. */
export const NS = 'dsh-marginalia'

export const en = {
  'menu.label': 'Side question',
  'menu.description': 'Ask beside the main thread — no tools, no transcript pollution',
  'menu.hint': 'What do you want to ask?',
  'menu.group': 'Marginalia',

  'bubble.aria': 'Marginalia side question',
  'bubble.followUp': 'Follow up',
  'bubble.openHistory': 'Topic history',

  'status.starting': 'Starting…',
  'status.answering': 'Answering in the margin…',
  'status.cancelled': 'Cancelled — partial answer kept',
  'status.interrupted': 'Interrupted — see history',
  'status.failed': 'Failed',

  'action.stop': 'Stop answering',
  'action.close': 'Close',
  'action.copy': 'Copy answer',
  'action.copied': 'Copied',
  'action.collapse': 'Collapse',
  'action.expand': 'Expand',
  'action.retry': 'Retry',
  'action.followUp': 'Follow up',
  'action.history': 'History',
  'action.delete': 'Delete topic',

  'follow.placeholder': 'Ask a follow-up in this topic…',
  'follow.send': 'Send follow-up',
  'follow.hint': 'Enter to send · Shift+Enter for a new line',

  'error.attachments': 'Side questions accept text only. Remove the images and files first.',
  'error.empty': 'Type a question after /btw.',
  'error.length': 'The question is too long.',
  'error.subagent': 'Side questions are available in the main session, not in a subagent view.',
  'error.busy': 'A side question is already running in this session.',
  'error.capacity': 'Too many side questions are running. Try again shortly.',
  'error.copy': 'Copy failed. Select the answer text instead.',
  'error.generic': 'The side question failed.',
  'error.notAttached': 'Could not attach to the side session. Open history to refresh.',
  'error.cancelled': 'Cancelled.',
  'error.backend': 'The Marginalia host is unavailable. Check that the plugin is enabled.',
  'error.history': 'Could not load side-question history.',
  'error.delete': 'Could not delete the topic.',
  'error.cancel': 'Could not cancel the side question.',
  'error.follow': 'Could not start the follow-up.',

  'history.title': 'Marginalia',
  'history.subtitle': 'Read-only questions asked beside this session',
  'history.empty': 'No side questions yet',
  'history.emptyHint': 'Type /btw followed by a question. Answers stay here and never enter the main transcript.',
  'history.askPlaceholder': 'Ask a side question…',
  'history.ask': 'Ask',
  'history.turns': '{count} turns',
  'history.noAnswer': 'No answer was saved.',
  'history.deleteConfirm': 'Delete this topic and its side history? The main conversation is untouched.',
  'history.reload': 'Refresh',
  'history.close': 'Close',
  'history.loading': 'Loading…',
  'history.followPlaceholder': 'Follow up in this topic…',
  'history.follow': 'Follow up',
  'history.copy': 'Copy',
  'history.copied': 'Copied',
  'history.question': 'Question',
  'history.answer': 'Answer',
  'history.status.running': 'Running',
  'history.status.complete': 'Complete',
  'history.status.cancelled': 'Cancelled',
  'history.status.error': 'Error',
  'history.status.interrupted': 'Interrupted',
  'history.earlier': 'Earlier turns',
  'history.footer': 'Same session · same model · no tool execution',

  'relative.justNow': 'just now',
  'relative.minutes': '{count}m ago',
  'relative.hours': '{count}h ago',
  'relative.days': '{count}d ago',

  'footer.hint': 'Read-only · same context · no tools',
} as const

export type MessageKey = keyof typeof en
export type TranslateFn = (key: MessageKey, vars?: Record<string, string | number>) => string

export const zh: Record<MessageKey, string> = {
  'menu.label': '边注旁问',
  'menu.description': '在主对话旁提问——不执行工具，不污染主记录',
  'menu.hint': '想问什么？',
  'menu.group': '边注',

  'bubble.aria': '边注旁问',
  'bubble.followUp': '继续追问',
  'bubble.openHistory': '主题历史',

  'status.starting': '正在启动…',
  'status.answering': '正在旁注中回答…',
  'status.cancelled': '已取消——保留已生成内容',
  'status.interrupted': '已中断——请查看历史',
  'status.failed': '失败',

  'action.stop': '停止回答',
  'action.close': '关闭',
  'action.copy': '复制回答',
  'action.copied': '已复制',
  'action.collapse': '折叠',
  'action.expand': '展开',
  'action.retry': '重试',
  'action.followUp': '继续追问',
  'action.history': '历史',
  'action.delete': '删除主题',

  'follow.placeholder': '在这个主题下继续追问…',
  'follow.send': '发送追问',
  'follow.hint': 'Enter 发送 · Shift+Enter 换行',

  'error.attachments': '旁问只接受文字，请先移除图片和文件。',
  'error.empty': '请在 /btw 后输入问题。',
  'error.length': '问题过长。',
  'error.subagent': '旁问仅在主会话可用，子代理视图不支持。',
  'error.busy': '当前会话已有一个旁问在进行。',
  'error.capacity': '同时进行的旁问过多，请稍后再试。',
  'error.copy': '复制失败，请手动选择回答文字。',
  'error.generic': '旁问失败。',
  'error.notAttached': '无法连接旁问子会话，请打开历史刷新。',
  'error.cancelled': '已取消。',
  'error.backend': 'Marginalia 宿主不可用，请确认插件已启用。',
  'error.history': '无法加载旁问历史。',
  'error.delete': '无法删除主题。',
  'error.cancel': '无法取消旁问。',
  'error.follow': '无法发送追问。',

  'history.title': '边注 Marginalia',
  'history.subtitle': '在这个主会话旁提出的只读问题',
  'history.empty': '还没有旁问',
  'history.emptyHint': '输入 /btw 加问题。回答留在这里，不会进入主对话记录。',
  'history.askPlaceholder': '提出一个旁问…',
  'history.ask': '提问',
  'history.turns': '{count} 轮',
  'history.noAnswer': '没有保存回答。',
  'history.deleteConfirm': '删除这个主题及其旁问历史？主对话不会受影响。',
  'history.reload': '刷新',
  'history.close': '关闭',
  'history.loading': '加载中…',
  'history.followPlaceholder': '在这个主题下继续追问…',
  'history.follow': '追问',
  'history.copy': '复制',
  'history.copied': '已复制',
  'history.question': '问题',
  'history.answer': '回答',
  'history.status.running': '进行中',
  'history.status.complete': '已完成',
  'history.status.cancelled': '已取消',
  'history.status.error': '错误',
  'history.status.interrupted': '已中断',
  'history.earlier': '更早的轮次',
  'history.footer': '同一会话 · 同一模型 · 不执行工具',

  'relative.justNow': '刚刚',
  'relative.minutes': '{count} 分钟前',
  'relative.hours': '{count} 小时前',
  'relative.days': '{count} 天前',

  'footer.hint': '只读 · 同一上下文 · 不执行工具',
}

export const dictionaries = { zh, en }

/** Fallback used when the Host locale service has not bound our namespace yet. */
export function fallbackTranslate(locale: 'zh' | 'en' = 'zh'): TranslateFn {
  const dict = dictionaries[locale]
  return (key, vars) => interpolate(dict[key] ?? en[key] ?? key, vars)
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

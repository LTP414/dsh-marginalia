import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { INTERNAL_COMMANDS, PLUGIN_NAME, commandLine, type InternalCommand } from '../shared'
import { BubbleLayer } from './Bubble'
import { HistoryOverlay } from './HistoryOverlay'
import { MarginaliaIcon } from './Icons'
import { dictionaries, fallbackTranslate, NS, type TranslateFn } from './locales'
import type { Bridge, ConversationLike, SessionsLike } from './store'
import { MarginaliaStore } from './store'
import { createBtwTriggerSource } from './trigger'
import { CSS } from './styles'

export const name = PLUGIN_NAME
export const inject = ['slots', 'remote', 'remote.commands', 'locale', 'sessions', 'uiConversation', 'inputTriggers']

interface CommandRemote {
  execute(
    sessionId: string,
    line: string,
    attachments: readonly never[],
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean
    error?: { message?: string }
    value?: { result?: { kind?: string; text?: string } }
  }>
}

interface SlotRegistryLike {
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: (props: any) => React.JSX.Element | null): () => void
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS as never, dictionaries as never))
  const bound = ctx.locale.bind(NS) as unknown as (key: string, vars?: Record<string, string | number>) => string
  const t: TranslateFn = (key, vars) => {
    try {
      const text = bound(key, vars)
      if (text) return text
    } catch {
      // Fall through to the bundled dictionary.
    }
    return fallbackTranslate(activeLocale(ctx))(key, vars)
  }

  const remote = ctx.remote as unknown as { commands: CommandRemote }
  const bridge: Bridge = {
    call: async (sessionId, name, payload, signal) => {
      const line = commandLine(name as InternalCommand, payload)
      const response = await remote.commands.execute(sessionId as never, line, [], signal)
      if (!response.ok) throw new Error(response.error?.message || t('error.backend'))
      const result = response.value?.result
      if (!result || result.kind !== 'success') throw new Error(result?.text || t('error.generic'))
      if (!result.text) throw new Error(t('error.backend'))
      try {
        return JSON.parse(result.text)
      } catch {
        throw new Error(t('error.backend'))
      }
    },
  }

  const store = new MarginaliaStore({
    bridge,
    sessions: ctx.sessions as unknown as SessionsLike,
    conversation: ctx.uiConversation as unknown as ConversationLike,
    t,
    locale: () => activeLocale(ctx),
    log: (message, error) => ctx.logger.warn(message, error),
  })

  ctx.effect(() => ctx.inputTriggers.registerSource(createBtwTriggerSource({ store, t })))

  const slots = ctx.slots as unknown as SlotRegistryLike
  ctx.effect(() => slots.inject('conversation.input.overlay', () => slots.register(
    { name: 'conversation.input.overlay', id: 'dsh-marginalia-bubbles', order: 25, locale: NS },
    props => <BubbleLayer store={store} sessionId={String(props.sessionId)} />,
  )))

  ctx.effect(() => slots.inject('conversation.input.left', () => slots.register(
    { name: 'conversation.input.left', id: 'dsh-marginalia-history-button', order: 40, locale: NS },
    props => <HistoryButton store={store} sessionId={String(props.sessionId)} />,
  )))

  ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'dsh-marginalia-history', order: 30, locale: NS },
    () => <HistoryOverlay store={store} />,
  )))

  for (const command of INTERNAL_COMMANDS) {
    ctx.effect(() => slots.inject('conversation.chat.commandview', () => slots.register(
      { name: 'conversation.chat.commandview', key: command },
      () => null,
    )))
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = PLUGIN_NAME
    style.dataset.pluginCss = `${PLUGIN_NAME}/client.css`
    style.textContent = CSS
    ;(document.head ?? document.documentElement).append(style)
    return () => style.remove()
  })

  ctx.effect(() => () => store.dispose())
}

function HistoryButton({ store, sessionId }: { readonly store: MarginaliaStore; readonly sessionId: string }): React.JSX.Element | null {
  const t = store.t
  if (store.canAsk(sessionId)) return null
  return (
    <button
      type="button"
      className="mgl-icon-button mgl-tool-button"
      title={t('action.history')}
      aria-label={t('action.history')}
      onClick={() => { void store.openHistory(sessionId) }}
    >
      <MarginaliaIcon size={16} />
    </button>
  )
}

function activeLocale(ctx: Context): 'zh' | 'en' {
  try {
    const active = ctx.locale.getLocale().active
    return String(active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

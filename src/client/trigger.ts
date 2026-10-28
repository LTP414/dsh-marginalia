/**
 * `/btw` as an input-trigger source rather than a monkey-patched command UI.
 *
 * The source contributes one slash candidate, claims arg-tolerant input, and
 * routes submission into the client store. The Host command with the same name
 * is deliberately not registered, so there is no catalog collision.
 */
import type {
  ClientSessionContext,
  InputTriggerSource,
  PickOutcome,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { MarginaliaStore } from './store'
import type { TranslateFn } from './locales'

export interface TriggerSourceOptions {
  readonly store: MarginaliaStore
  readonly t: TranslateFn
}

export const TRIGGER_SOURCE = 'dsh-marginalia'

export function createBtwTriggerSource({ store, t }: TriggerSourceOptions): InputTriggerSource {
  const claim = (session: ClientSessionContext): PickOutcome => ({
    claim: {
      name: 'btw',
      token: '/btw ',
      hint: t('menu.hint'),
      submit: async (args, _actx, attachments) => {
        if (attachments.length > 0) return { kind: 'error', text: t('error.attachments') }
        const question = args.trim()
        const blocked = store.canAsk(session.sessionId)
        if (blocked) return { kind: 'error', text: blocked }
        if (!question) {
          void store.openHistory(session.sessionId)
          return { kind: 'success' }
        }
        try {
          store.ask(session.sessionId, question)
          return { kind: 'success' }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : t('error.generic') }
        }
      },
    },
  })

  return {
    trigger: '/',
    name: TRIGGER_SOURCE,
    order: -10,
    showGroupTitle: false,
    candidates: async session => {
      if (store.canAsk(session.sessionId)) return []
      return [{
        name: 'btw',
        label: t('menu.label'),
        description: t('menu.description'),
        hint: t('menu.hint'),
        value: 'btw',
      }]
    },
    onPick: pick => claim(pick.session),
    matchSpace: (session, token) => token === '/btw' ? claim(session) : undefined,
    matchEnter: async (session, line) => /^\/btw(?:\s|$)/.test(line.trim()) ? claim(session) : undefined,
  }
}

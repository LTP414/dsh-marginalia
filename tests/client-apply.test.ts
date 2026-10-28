import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubBrowser(): void {
  vi.stubGlobal('document', {
    createElement: () => ({ dataset: {}, textContent: '', innerHTML: '', remove: () => {} }),
    head: { append: () => {} },
    documentElement: { append: () => {} },
  })
  vi.stubGlobal('crypto', {
    // A plain-HTTP origin: getRandomValues exists, randomUUID does not.
    getRandomValues: (target: Uint8Array) => {
      target.fill(0x5a)
      return target
    },
  })
}

function fakeContext() {
  const sources: any[] = []
  const slots: Array<{ key: string; options: any }> = []
  const effects: Array<() => unknown> = []
  const calls: Array<{ name: string; payload: unknown }> = []
  const session = {
    getSnapshot: () => ({ running: true, openState: 'open', subagent: null }),
    subscribe: () => () => {},
  }
  const ctx: any = {
    logger: { warn: () => {} },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
      getLocale: () => ({ active: 'en-US' }),
    },
    effect: (fn: () => unknown) => {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose as () => unknown)
      return () => {}
    },
    slots: {
      inject: (key: string, callback: () => () => void) => {
        const dispose = callback()
        return dispose
      },
      register: (options: any) => {
        slots.push({ key: String(options.name), options })
        return () => {}
      },
    },
    inputTriggers: {
      registerSource: (source: any) => {
        sources.push(source)
        return () => {}
      },
    },
    sessions: {
      retain: () => ({
        sessionId: 'child',
        ready: Promise.resolve(),
        binding: { session },
        release: () => {},
      }),
      binding: () => ({ session }),
    },
    uiConversation: {
      binding: () => ({
        target: () => ({
          getSnapshot: () => ({ legacy: { partial: null, nodes: [] } }),
          subscribe: () => () => {},
        }),
      }),
    },
    remote: {
      commands: {
        execute: async (_sessionId: string, line: string, _attachments: unknown[], _signal?: AbortSignal) => {
          const name = line.slice(1).split(' ')[0] ?? ''
          calls.push({ name, payload: line })
          if (name === 'btw-ask') {
            return {
              ok: true,
              value: {
                result: {
                  kind: 'success',
                  text: JSON.stringify({
                    topic: { id: '22222222-2222-4222-8222-222222222222', parentSessionId: 'parent-1', title: 'Q', createdAt: 1, updatedAt: 1, turns: [] },
                    turn: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', question: 'Q', answer: '', status: 'running', createdAt: 1, updatedAt: 1 },
                  }),
                },
              },
            }
          }
          return { ok: true, value: { result: { kind: 'success', text: '{}' } } }
        },
      },
    },
  }
  return { ctx, sources, slots, effects, calls }
}

describe('client apply smoke', () => {
  it('loads and claims /btw on a plain-HTTP browser without crypto.randomUUID', async () => {
    stubBrowser()
    const h = fakeContext()
    const { apply } = await import('../src/client/index')
    apply(h.ctx)

    expect(h.sources).toHaveLength(1)
    expect(h.slots.map(slot => slot.options.id)).toContain('dsh-marginalia-bubbles')
    expect(h.slots.map(slot => slot.options.id)).toContain('dsh-marginalia-history-button')
    expect(h.slots.map(slot => slot.options.id)).toContain('dsh-marginalia-history')

    const source = h.sources[0]
    const outcome = await source.matchEnter({ sessionId: 'parent-1' }, '/btw Why?', new AbortController().signal, { attachments: 0 })
    expect(outcome && typeof outcome === 'object' && 'claim' in outcome).toBe(true)
    const result = await outcome.claim.submit('Why?', {}, [])
    expect(result).toEqual({ kind: 'success' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(h.calls.some(call => call.name === 'btw-ask')).toBe(true)
    expect((globalThis.crypto as Crypto).randomUUID).toBeUndefined()

    for (const dispose of [...h.effects].reverse()) await dispose()
  })
})

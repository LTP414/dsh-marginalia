import { describe, expect, it, vi } from 'vitest'
import { createBtwTriggerSource } from '../src/client/trigger'
import { fallbackTranslate } from '../src/client/locales'
import type { MarginaliaStore } from '../src/client/store'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

function claimOf(outcome: unknown): any {
  if (!outcome || typeof outcome !== 'object' || !('claim' in outcome)) throw new Error('not claimed')
  return (outcome as { claim: any }).claim
}

function fakeStore(overrides: Partial<MarginaliaStore> = {}) {
  return {
    canAsk: vi.fn(() => undefined),
    ask: vi.fn(() => 'id'),
    openHistory: vi.fn(async () => {}),
    followUp: vi.fn(),
    t: fallbackTranslate('en'),
    ...overrides,
  } as unknown as MarginaliaStore
}

describe('trigger source', () => {
  const session = { sessionId: 'parent-1' } as ClientSessionContext
  const t = fallbackTranslate('en')

  it('offers one /btw candidate', async () => {
    const source = createBtwTriggerSource({ store: fakeStore(), t })
    const candidates = await source.candidates(session, { query: 'bt', position: 'leading', signal: new AbortController().signal, drilled: false } as never)
    expect(source.trigger).toBe('/')
    expect(candidates.map(candidate => candidate.name)).toEqual(['btw'])
  })

  it('hides the candidate in a subagent view', async () => {
    const store = fakeStore({ canAsk: vi.fn(() => 'not here') } as never)
    const source = createBtwTriggerSource({ store, t })
    expect(await source.candidates(session, {} as never)).toEqual([])
  })

  it('claims /btw with and without arguments', async () => {
    const source = createBtwTriggerSource({ store: fakeStore(), t })
    expect(source.matchSpace?.(session, '/btw')).toBeDefined()
    expect(source.matchSpace?.(session, '/btwx')).toBeUndefined()
    const enter = await source.matchEnter?.(session, '/btw why?', new AbortController().signal, { attachments: 0 })
    expect(enter && typeof enter === 'object' && 'claim' in enter).toBe(true)
    const bare = await source.matchEnter?.(session, '/btw', new AbortController().signal, { attachments: 0 })
    expect(bare && typeof bare === 'object' && 'claim' in bare).toBe(true)
  })

  it('routes arguments to ask and an empty argument to history', async () => {
    const store = fakeStore()
    const source = createBtwTriggerSource({ store, t })
    const outcome = await source.matchEnter?.(session, '/btw why?', new AbortController().signal, { attachments: 0 })
    const claim = claimOf(outcome)
    await expect(claim.submit('why?', {} as never, [])).resolves.toEqual({ kind: 'success' })
    expect(store.ask).toHaveBeenCalledWith('parent-1', 'why?')

    await expect(claim.submit('   ', {} as never, [])).resolves.toEqual({ kind: 'success' })
    expect(store.openHistory).toHaveBeenCalledWith('parent-1')
  })

  it('refuses attachments with a visible error', async () => {
    const store = fakeStore()
    const source = createBtwTriggerSource({ store, t })
    const outcome = await source.matchEnter?.(session, '/btw why?', new AbortController().signal, { attachments: 1 })
    const result = await claimOf(outcome).submit('why?', {} as never, [{ type: 'image' } as never])
    expect(result.kind).toBe('error')
    expect(store.ask).not.toHaveBeenCalled()
  })

  it('refuses a subagent session', async () => {
    const store = fakeStore({ canAsk: vi.fn(() => 'not here') } as never)
    const source = createBtwTriggerSource({ store, t })
    const outcome = await source.matchEnter?.(session, '/btw why?', new AbortController().signal, { attachments: 0 })
    await expect(claimOf(outcome).submit('why?', {} as never, [])).resolves.toEqual({ kind: 'error', text: 'not here' })
  })
})

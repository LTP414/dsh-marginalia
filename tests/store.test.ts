import { describe, expect, it, vi } from 'vitest'
import { BtwStore } from '../src/host/store'
import type { BtwTopic, BtwTurn } from '../src/shared'

function turn(overrides: Partial<BtwTurn> = {}): BtwTurn {
  return {
    id: 'turn-1',
    question: 'Why?',
    answer: 'Because.',
    status: 'complete',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function topic(id: string, parentSessionId = 'parent-1', overrides: Partial<BtwTopic> = {}): BtwTopic {
  return {
    id,
    parentSessionId,
    title: `Topic ${id}`,
    createdAt: 1,
    updatedAt: 2,
    turns: [turn()],
    ...overrides,
  }
}

function makeTable() {
  const map = new Map<string, BtwTopic>()
  return {
    get: (key: string) => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    get size() { return map.size },
    put: async (key: string, value: BtwTopic) => { map.set(key, value) },
    delete: async (key: string) => map.delete(key),
    map,
  }
}

function makeContext(table = makeTable()) {
  const domain = { table: () => table, close: async () => {} }
  const warn = vi.fn()
  return {
    table,
    warn,
    ctx: {
      get: (name: string) => name === 'storageDomain' ? { open: async () => domain } : undefined,
      logger: { warn },
    },
  }
}

describe('BtwStore', () => {
  it('stores, lists, and isolates topics by parent session', async () => {
    const { ctx } = makeContext()
    const store = await BtwStore.open(ctx)
    expect(store.mode).toBe('storage')
    await store.put(topic('t1', 'parent-1', { updatedAt: 10 }))
    await store.put(topic('t2', 'parent-1', { updatedAt: 20 }))
    await store.put(topic('t3', 'parent-2', { updatedAt: 30 }))

    expect(store.list('parent-1').map(row => row.id)).toEqual(['t2', 't1'])
    expect(store.list('parent-1', 1).map(row => row.id)).toEqual(['t2'])
    expect(store.get('parent-2', 't3')?.title).toBe('Topic t3')
    expect(store.get('parent-1', 't3')).toBeUndefined()
    await store.close()
  })

  it('turns crash-left running turns into interrupted on reopen', async () => {
    const { table, ctx } = makeContext()
    const store = await BtwStore.open(ctx)
    await store.put(topic('crashed', 'parent-1', { turns: [turn({ status: 'running' })] }))
    await store.close()

    const reopened = await BtwStore.open(ctx)
    const repaired = reopened.get('parent-1', 'crashed')
    expect(repaired?.turns[0]?.status).toBe('interrupted')
    expect(repaired?.turns[0]?.answer).toBe('Because.')
    expect(table.map.size).toBe(1)
    await reopened.close()
  })

  it('serializes writes per topic key', async () => {
    const { ctx } = makeContext()
    const store = await BtwStore.open(ctx)
    const base = topic('serial')
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.put({
      ...base,
      title: `v${index}`,
      updatedAt: index,
    })))
    expect(store.get('parent-1', 'serial')?.title).toBe('v19')
    await store.close()
  })

  it('falls back to memory without the storage domain', async () => {
    const store = await BtwStore.open({ get: () => undefined, logger: { warn: vi.fn() } })
    expect(store.mode).toBe('memory')
    await store.put(topic('m1'))
    expect(store.list('parent-1')).toHaveLength(1)
    await store.close()
  })

  it('deletes only the requested topic', async () => {
    const { ctx } = makeContext()
    const store = await BtwStore.open(ctx)
    await store.put(topic('a'))
    await store.put(topic('b'))
    expect(await store.delete('parent-1', 'a')).toBe(true)
    expect(store.get('parent-1', 'a')).toBeUndefined()
    expect(store.get('parent-1', 'b')?.id).toBe('b')
    await store.close()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index'
import { ASK_COMMAND, GET_COMMAND, LIST_COMMAND, type BtwTopic } from '../src/shared'
import type { ChildResult } from '../src/host/engine'

const TURN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PARENT = 'parent-1'

async function waitFor(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function harness() {
  const topics = new Map<string, BtwTopic>()
  const defs = new Map<string, any>()
  const effects: Array<() => unknown> = []
  const listeners = new Map<string, Set<(...args: any[]) => any>>()
  const toolGuards: Array<(execution: any) => string | undefined> = []
  const activations: any[] = []
  const archive = vi.fn(async () => {})
  const warn = vi.fn()
  const table = {
    get: (key: string) => topics.get(key),
    entries: () => topics.entries(),
    keys: () => topics.keys(),
    get size() { return topics.size },
    put: async (key: string, value: BtwTopic) => { topics.set(key, value) },
    delete: async (key: string) => topics.delete(key),
  }
  const domain = { table: () => table, close: async () => {} }
  const ctx: any = {
    logger: { warn, info: vi.fn() },
    get: (name: string) => {
      if (name === 'storageDomain') return { open: async () => domain }
      if (name === 'workspaceRegistry') return { archiveSession: archive }
      return undefined
    },
    effect: (fn: () => unknown) => {
      const dispose = fn()
      if (typeof dispose === 'function') effects.push(dispose as () => unknown)
      return () => {}
    },
    on: (event: string, fn: (...args: any[]) => any) => {
      const set = listeners.get(event) ?? new Set()
      set.add(fn)
      listeners.set(event, set)
      return () => set.delete(fn)
    },
    tools: {
      guard: (fn: (execution: any) => string | undefined) => {
        toolGuards.push(fn)
        return () => {}
      },
    },
    commands: {
      register: (definition: any) => {
        defs.set(definition.name, definition)
        return () => defs.delete(definition.name)
      },
      list: (_agent: unknown) => [...defs.values()].map(definition => ({ name: definition.name })),
    },
    subagents: {
      getProvider: () => ({ name: 'fork', inheritsParentContext: true }),
      startActivation: async (spec: any) => {
        const activation = {
          childId: spec.childId,
          spec,
          resolve: undefined as undefined | ((result: ChildResult) => void),
          result: undefined as unknown as Promise<ChildResult>,
          dispose: vi.fn(async () => {}),
        }
        activation.result = new Promise<ChildResult>((resolve) => { activation.resolve = resolve })
        activations.push(activation)
        return activation
      },
    },
  }
  return { ctx, topics, defs, effects, listeners, toolGuards, activations, archive, warn }
}

function invocation(rawInput: string) {
  return {
    rawInput,
    agent: {
      id: PARENT,
      status: 'running',
      options: { maxTokens: 64_000 },
      session: { header: { id: PARENT }, snapshotEvents: () => [] },
    },
    signal: new AbortController().signal,
    commandId: 'cmd',
    attachments: [],
  }
}

describe('host wiring', () => {
  it('registers hidden commands, starts a guarded child, and persists completion', async () => {
    const h = harness()
    await apply(h.ctx)

    expect(h.defs.has(ASK_COMMAND)).toBe(true)
    expect(h.defs.has(GET_COMMAND)).toBe(true)
    expect(h.defs.has(LIST_COMMAND)).toBe(true)
    expect(h.ctx.commands.list({}).map((row: { name: string }) => row.name)).not.toContain(ASK_COMMAND)

    const result = await h.defs.get(ASK_COMMAND).handler(invocation(JSON.stringify({ turnId: TURN, question: 'Why B?', locale: 'en' })))
    expect(result.kind).toBe('success')
    const accepted = JSON.parse(result.text)
    expect(accepted.turn.status).toBe('running')
    expect(h.activations).toHaveLength(1)
    expect(h.activations[0].childId).toBe(TURN)
    expect(h.activations[0].spec.request.parent.id).toBe(PARENT)
    expect(h.activations[0].spec.request.agentOptions.maxTokens).toBe(32_000)
    expect(h.toolGuards.some(guard => guard({ agent: { id: TURN } }))).toBe(true)

    // Stream capture is wired from the Host event.
    for (const listener of h.listeners.get('agent/assistant-stream') ?? []) {
      listener({ agent: { id: TURN }, frame: { type: 'start' } })
      listener({ agent: { id: TURN }, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'Partial' } } })
    }
    h.activations[0].resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Because B is cheaper.' }] })
    await waitFor(() => [...h.topics.values()][0]?.turns[0]?.status === 'complete')
    await waitFor(() => h.archive.mock.calls.length > 0)
    const topic = [...h.topics.values()][0]!
    expect(topic.turns[0]?.answer).toBe('Because B is cheaper.')
    expect(h.archive).toHaveBeenCalledWith(TURN)

    const list = h.defs.get(LIST_COMMAND).handler(invocation(''))
    expect(JSON.parse(list.text).topics).toHaveLength(1)
    const get = h.defs.get(GET_COMMAND).handler(invocation(JSON.stringify({ topicId: topic.id })))
    expect(JSON.parse(get.text).topic.turns[0].status).toBe('complete')

    for (const dispose of [...h.effects].reverse()) await dispose()
  })

  it('rejects malformed transport input without starting a child', async () => {
    const h = harness()
    await apply(h.ctx)
    const result = await h.defs.get(ASK_COMMAND).handler(invocation(JSON.stringify({ turnId: 'bad', question: 'x' })))
    expect(result.kind).toBe('error')
    expect(h.activations).toHaveLength(0)
    for (const dispose of [...h.effects].reverse()) await dispose()
  })
})

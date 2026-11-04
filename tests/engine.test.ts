import { describe, expect, it, vi } from 'vitest'
import { BtwEngine, BtwBusyError, type ChildResult, type StartChildRequest } from '../src/host/engine'
import { BtwStore } from '../src/host/store'
import { ChildGuard } from '../src/host/tool-guard'
import { StreamCapture } from '../src/host/parent-context'
import type { BtwTopic } from '../src/shared'

const TURN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TURN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TURN_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

async function waitFor(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function makeStore() {
  const map = new Map<string, BtwTopic>()
  const table = {
    get: (key: string) => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    get size() { return map.size },
    put: async (key: string, value: BtwTopic) => { map.set(key, value) },
    delete: async (key: string) => map.delete(key),
  }
  const ctx = {
    get: (name: string) => name === 'storageDomain' ? { open: async () => ({ table: () => table, close: async () => {} }) } : undefined,
    logger: { warn: () => {} },
  }
  return { map, store: await BtwStore.open(ctx) }
}

interface FakeStart {
  readonly requests: StartChildRequest[]
  readonly disposed: string[]
  resolve(result: ChildResult): void
}

function makeStarter(options: { readonly defer?: boolean } = {}): { startChild: (request: StartChildRequest) => Promise<{ result: Promise<ChildResult>; dispose(): Promise<void> }>; fake: FakeStart } {
  const requests: StartChildRequest[] = []
  const disposed: string[] = []
  const resolvers = new Map<string, (result: ChildResult) => void>()
  const startChild = async (request: StartChildRequest) => {
    requests.push(request)
    let resolveResult!: (result: ChildResult) => void
    const result = new Promise<ChildResult>((resolve) => {
      resolveResult = resolve
      if (request.signal.aborted) resolve({ stopReason: 'aborted', output: [] })
      else request.signal.addEventListener('abort', () => resolve({ stopReason: 'aborted', output: [] }), { once: true })
    })
    resolvers.set(request.childId, resolveResult)
    return {
      result,
      dispose: async () => { disposed.push(request.childId) },
    }
  }
  return {
    startChild,
    fake: {
      requests,
      disposed,
      resolve(result: ChildResult) {
        const id = requests.at(-1)!.childId
        resolvers.get(id)?.(result)
      },
    },
  }
}

function parent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'parent-1',
    status: 'running' as const,
    options: { maxTokens: 100_000 },
    session: { snapshotEvents: () => [] as const },
    ...overrides,
  }
}

function engineFor(store: BtwStore, startChild: (request: StartChildRequest) => Promise<{ result: Promise<ChildResult>; dispose(): Promise<void> }>, extra: Partial<ConstructorParameters<typeof BtwEngine>[0]> = {}) {
  const guard = new ChildGuard()
  const capture = new StreamCapture()
  const engine = new BtwEngine({
    store,
    startChild,
    guard,
    capture,
    now: () => 1_000,
    uuid: () => '33333333-3333-4333-8333-333333333333',
    timeoutMs: 5_000,
    ...extra,
  })
  return { engine, guard, capture }
}

describe('BtwEngine', () => {
  it('accepts quickly, then persists a completed answer and cleans up', async () => {
    const { store } = await makeStore()
    const { startChild, fake } = makeStarter()
    const { engine, guard } = engineFor(store, startChild)
    const accepted = await engine.ask({ parent: parent(), turnId: TURN_A, question: 'Why B?', locale: 'en' })
    expect(accepted.turn.status).toBe('running')
    expect(accepted.topic.turns).toHaveLength(1)
    expect(fake.requests[0]?.prompt).toContain('Why B?')
    expect(fake.requests[0]?.maxTokens).toBe(32_000)
    expect(guard.has(TURN_A)).toBe(true)

    fake.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Because B is cheaper.' }] })
    await waitFor(() => store.get('parent-1', accepted.topic.id)?.turns[0]?.status === 'complete')
    const turn = store.get('parent-1', accepted.topic.id)!.turns[0]!
    expect(turn.answer).toBe('Because B is cheaper.')
    expect(turn.childSessionId).toBe(TURN_A)
    expect(fake.disposed).toEqual([TURN_A])
    expect(guard.has(TURN_A)).toBe(false)
    await engine.dispose()
    await store.close()
  })

  it('injects the open first-turn task while the parent is running', async () => {
    const { store } = await makeStore()
    const { startChild, fake } = makeStarter()
    const { engine } = engineFor(store, startChild)
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Ship the release checklist' }] },
      },
      { type: 'step/start', data: { turn: 1, step: 1 } },
      {
        type: 'tool/call',
        data: { callId: 'c1', name: 'bash', arguments: '{"command":"pnpm test"}' },
      },
    ]
    const accepted = await engine.ask({
      parent: parent({ session: { snapshotEvents: () => events } }),
      turnId: TURN_A,
      question: 'What is the current task?',
      locale: 'en',
    })
    const prompt = fake.requests[0]?.prompt ?? ''
    expect(prompt).toContain('<parent-in-progress>')
    expect(prompt).toContain('Ship the release checklist')
    expect(prompt).toContain('bash(command=pnpm test)')
    expect(prompt).not.toContain('Old completed task')
    fake.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Shipping.' }] })
    await waitFor(() => store.get('parent-1', accepted.topic.id)?.turns[0]?.status === 'complete')
    await engine.dispose()
    await store.close()
  })

  it('injects topic history and current parent context into a follow-up', async () => {
    const { store } = await makeStore()
    const { startChild, fake } = makeStarter()
    const { engine, capture } = engineFor(store, startChild)
    const first = await engine.ask({ parent: parent(), turnId: TURN_A, question: 'Why B?', locale: 'en' })
    fake.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Because it is cheaper.' }] })
    await waitFor(() => store.get('parent-1', first.topic.id)?.turns[0]?.status === 'complete')

    capture.observe('parent-1', { type: 'start' })
    capture.observe('parent-1', { type: 'chunk', chunk: { type: 'text-delta', text: 'The main answer is still streaming' } })
    const followParent = parent({
      session: {
        snapshotEvents: () => [
          { type: 'tool/call', data: { callId: 'call-1', name: 'bash' } },
        ],
      },
    })
    const second = await engine.ask({
      parent: followParent,
      turnId: TURN_B,
      topicId: first.topic.id,
      question: 'And then?',
      locale: 'en',
    })
    const prompt = fake.requests[1]!.prompt
    expect(prompt).toContain('User: Why B?')
    expect(prompt).toContain('Assistant: Because it is cheaper.')
    expect(prompt).toContain('The main answer is still streaming')
    expect(prompt).toContain('Recent tool activity:')
    expect(prompt).toContain('bash() → running')
    expect(second.topic.turns).toHaveLength(2)
    fake.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Still B.' }] })
    await waitFor(() => store.get('parent-1', second.topic.id)?.turns[1]?.status === 'complete')
    await engine.dispose()
    await store.close()
  })

  it('refuses a second concurrent ask for the same parent', async () => {
    const { store } = await makeStore()
    const { startChild } = makeStarter()
    const { engine } = engineFor(store, startChild)
    await engine.ask({ parent: parent(), turnId: TURN_A, question: 'First?', locale: 'en' })
    await expect(engine.ask({ parent: parent(), turnId: TURN_B, question: 'Second?', locale: 'en' })).rejects.toBeInstanceOf(BtwBusyError)
    await engine.dispose()
    await store.close()
  })

  it('cancels, keeps the captured partial answer, and disposes the child', async () => {
    const { store } = await makeStore()
    const { startChild, fake } = makeStarter()
    const { engine, capture } = engineFor(store, startChild)
    const accepted = await engine.ask({ parent: parent(), turnId: TURN_A, question: 'Why?', locale: 'en' })
    capture.observe(TURN_A, { type: 'start' })
    capture.observe(TURN_A, { type: 'chunk', chunk: { type: 'text-delta', text: 'Partial answer' } })
    await engine.cancel('parent-1', accepted.topic.id, TURN_A)
    await waitFor(() => store.get('parent-1', accepted.topic.id)?.turns[0]?.status === 'cancelled')
    const turn = store.get('parent-1', accepted.topic.id)!.turns[0]!
    expect(turn.answer).toBe('Partial answer')
    expect(fake.disposed).toEqual([TURN_A])
    await engine.dispose()
    await store.close()
  })

  it('times out a child and records an error', async () => {
    const { store } = await makeStore()
    const { startChild } = makeStarter()
    const { engine } = engineFor(store, startChild, { timeoutMs: 20 })
    const accepted = await engine.ask({ parent: parent(), turnId: TURN_A, question: 'Slow?', locale: 'en' })
    await waitFor(() => store.get('parent-1', accepted.topic.id)?.turns[0]?.status === 'error')
    const turn = store.get('parent-1', accepted.topic.id)!.turns[0]!
    expect(turn.error).toMatch(/timed out/i)
    await engine.dispose()
    await store.close()
  })

  it('archives the child when the completion hook is available', async () => {
    const { store } = await makeStore()
    const { startChild, fake } = makeStarter()
    const archiveChild = vi.fn(async () => {})
    const { engine } = engineFor(store, startChild, { archiveChild })
    const accepted = await engine.ask({ parent: parent(), turnId: TURN_C, question: 'Archive?', locale: 'en' })
    fake.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Done.' }] })
    await waitFor(() => store.get('parent-1', accepted.topic.id)?.turns[0]?.status === 'complete')
    expect(archiveChild).toHaveBeenCalledWith(TURN_C)
    await engine.dispose()
    await store.close()
  })

  it('marks running turns interrupted on unload', async () => {
    const { store } = await makeStore()
    const { startChild } = makeStarter()
    const { engine } = engineFor(store, startChild)
    const accepted = await engine.ask({ parent: parent(), turnId: TURN_A, question: 'Stop?', locale: 'en' })
    await engine.dispose()
    const turn = store.get('parent-1', accepted.topic.id)!.turns[0]!
    expect(turn.status).toBe('interrupted')
    await store.close()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { ASK_COMMAND, CANCEL_COMMAND, DELETE_COMMAND, GET_COMMAND, LIST_COMMAND, summarizeTopic, type BtwTopic } from '../src/shared'
import { fallbackTranslate } from '../src/client/locales'
import { MarginaliaStore, type Bridge, type ConversationLike, type SessionsLike } from '../src/client/store'

const TURN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TOPIC_A = '22222222-2222-4222-8222-222222222222'
const CHILD_A = 'child-a'

async function waitFor(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function makeHarness(options: { readonly ask?: Bridge['call'] } = {}) {
  const calls: Array<{ name: string; payload: unknown }> = []
  let topic: BtwTopic | undefined
  const sessionState = { running: true, openState: 'open', subagent: null as unknown }
  const sessionListeners = new Set<() => void>()
  const chatListeners = new Set<() => void>()
  let chat: {
    legacy: {
      partial: { blocks: Array<{ kind: string; text?: string }> } | null
      nodes: Array<{ kind: string; blocks?: Array<{ kind: string; text?: string }> }>
    }
  } = {
    legacy: {
      partial: { blocks: [{ kind: 'text', text: '' }] },
      nodes: [],
    },
  }
  const session = {
    getSnapshot: () => sessionState,
    subscribe: (listener: () => void) => { sessionListeners.add(listener); return () => sessionListeners.delete(listener) },
  }
  const refs: Array<{ released: boolean }> = []
  const sessions: SessionsLike = {
    retain: (id) => {
      const ref = {
        sessionId: id,
        ready: Promise.resolve(),
        binding: { session },
        release: () => { ref.released = true },
        released: false,
      }
      refs.push(ref)
      return ref
    },
    binding: () => undefined,
  }
  const target = {
    getSnapshot: () => chat,
    subscribe: (listener: () => void) => { chatListeners.add(listener); return () => chatListeners.delete(listener) },
  }
  const conversation: ConversationLike = { binding: () => ({ target: () => target }) }

  const bridge: Bridge = {
    call: async (sessionId, name, payload, signal) => {
      calls.push({ name, payload })
      if (options.ask && name === ASK_COMMAND) return options.ask(sessionId, name, payload, signal)
      if (name === ASK_COMMAND) {
        const request = payload as { turnId: string; question: string }
        const turn = {
          id: request.turnId,
          question: request.question,
          answer: '',
          status: 'running' as const,
          createdAt: 1,
          updatedAt: 1,
          childSessionId: CHILD_A,
        }
        topic = {
          id: TOPIC_A,
          parentSessionId: sessionId,
          title: request.question,
          createdAt: 1,
          updatedAt: 1,
          turns: [turn],
        }
        return { topic, turn }
      }
      if (name === GET_COMMAND) {
        if (!topic) throw new Error('not found')
        const completed = {
          ...topic,
          turns: topic.turns.map(turn => ({ ...turn, status: 'complete' as const, answer: 'Final answer' })),
        }
        return { topic: completed }
      }
      if (name === LIST_COMMAND) {
        return { topics: topic ? [summarizeTopic(topic)] : [] }
      }
      if (name === DELETE_COMMAND) {
        topic = undefined
        return { deleted: true }
      }
      if (name === CANCEL_COMMAND) return { cancelled: true }
      throw new Error(`unexpected command ${name}`)
    },
  }

  const store = new MarginaliaStore({
    bridge,
    sessions,
    conversation,
    t: fallbackTranslate('en'),
    uuid: () => TURN_A,
    now: () => 10,
    source: 'test',
  })

  const notifyChat = (): void => { for (const listener of chatListeners) listener() }
  const setChat = (text: string, complete = false): void => {
    chat = {
      legacy: {
        partial: complete ? null : { blocks: [{ kind: 'text', text }] },
        nodes: complete ? [{ kind: 'assistant', blocks: [{ kind: 'text', text }] }] : [],
      },
    }
    notifyChat()
  }
  const finishSession = (): void => {
    sessionState.running = false
    for (const listener of sessionListeners) listener()
  }

  return { store, calls, refs, setChat, finishSession, sessionState, getTopic: () => topic }
}

describe('MarginaliaStore', () => {
  it('streams child text into a bubble and finalizes from the Host', async () => {
    const h = makeHarness()
    h.store.ask('parent-1', 'Why B?')
    await waitFor(() => h.store.getSnapshot().bubbles[0]?.status === 'running')
    h.setChat('Streaming part')
    expect(h.store.getSnapshot().bubbles[0]?.answer).toBe('Streaming part')
    h.setChat('Final answer', true)
    h.finishSession()
    await waitFor(() => h.store.getSnapshot().bubbles[0]?.status === 'complete')
    const bubble = h.store.getSnapshot().bubbles[0]!
    expect(bubble.answer).toBe('Final answer')
    expect(bubble.topicId).toBe(TOPIC_A)
    expect(h.refs[0]?.released).toBe(true)
    await h.store.dispose()
  })

  it('surfaces a host rejection as a bubble error', async () => {
    const h = makeHarness({ ask: async () => { throw new Error('A side question is already running in this session.') } })
    h.store.ask('parent-1', 'Busy?')
    await waitFor(() => h.store.getSnapshot().bubbles[0]?.status === 'error')
    expect(h.store.getSnapshot().bubbles[0]?.error).toContain('already running')
    await h.store.dispose()
  })

  it('refuses a second simultaneous local ask', async () => {
    const h = makeHarness()
    h.store.ask('parent-1', 'First?')
    expect(() => h.store.ask('parent-1', 'Second?')).toThrow(/already running/)
    await h.store.dispose()
  })

  it('opens, selects, and deletes history topics', async () => {
    const h = makeHarness()
    h.store.ask('parent-1', 'Why B?')
    await waitFor(() => h.store.getSnapshot().bubbles[0]?.status === 'running')
    h.setChat('Final answer', true)
    h.finishSession()
    await waitFor(() => h.store.getSnapshot().bubbles[0]?.status === 'complete')

    await h.store.openHistory('parent-1')
    await waitFor(() => h.store.getSnapshot().history?.loading === false)
    const history = h.store.getSnapshot().history!
    expect(history.topics).toHaveLength(1)
    expect(history.selectedId).toBe(TOPIC_A)
    await waitFor(() => h.store.getSnapshot().history?.loadingTopic === false && h.store.getSnapshot().history?.topic !== undefined)
    expect(h.store.getSnapshot().history?.topic?.turns[0]?.question).toBe('Why B?')

    await h.store.deleteTopic(TOPIC_A)
    expect(h.store.getSnapshot().history?.topics).toHaveLength(0)
    expect(h.store.getSnapshot().bubbles).toHaveLength(0)
    await h.store.dispose()
  })

  it('notifies the Host when a bubble is dismissed before acceptance', async () => {
    const h = makeHarness({
      ask: (sessionId, name, payload, signal) => new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        setTimeout(() => resolve({ topic: { id: TOPIC_A, parentSessionId: sessionId, title: 'x', createdAt: 1, updatedAt: 1, turns: [] }, turn: { id: TURN_A, question: 'x', answer: '', status: 'running', createdAt: 1, updatedAt: 1 } }), 50)
      }),
    })
    const id = h.store.ask('parent-1', 'Close me?')
    h.store.dismiss(id)
    expect(h.store.getSnapshot().bubbles).toHaveLength(0)
    await waitFor(() => h.calls.some(call => call.name === CANCEL_COMMAND))
    await h.store.dispose()
  })

  it('reports a subagent view as unavailable', () => {
    const h = makeHarness()
    h.sessionState.subagent = { address: 'child' }
    const store = new MarginaliaStore({
      bridge: { call: async () => ({}) },
      sessions: { retain: vi.fn() as never, binding: () => ({ session: { getSnapshot: () => h.sessionState, subscribe: () => () => {} } }) },
      t: fallbackTranslate('en'),
    })
    expect(store.canAsk('child')).toContain('main session')
    expect(() => store.ask('child', 'Q?')).toThrow(/main session/)
  })
})

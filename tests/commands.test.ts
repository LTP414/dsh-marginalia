import { describe, expect, it, vi } from 'vitest'
import { hideInternalCommands, quietInternalCommands, registerBtwCommands } from '../src/host/commands'
import { ASK_COMMAND, LIST_COMMAND } from '../src/shared'

const TURN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TOPIC = '22222222-2222-4222-8222-222222222222'

describe('hideInternalCommands', () => {
  it('filters only internal commands and restores the original method', () => {
    const commands = {
      list: (_agent: unknown) => [{ name: 'btw' }, { name: ASK_COMMAND }, { name: 'help' }],
    }
    const restore = hideInternalCommands(commands)
    expect(commands.list({}).map(row => row.name)).toEqual(['btw', 'help'])
    restore()
    expect(commands.list({}).map(row => row.name)).toEqual(['btw', ASK_COMMAND, 'help'])
  })

  it('keeps a later wrapper installed by another plugin', () => {
    const commands = {
      list: (_agent: unknown) => [{ name: ASK_COMMAND }],
    }
    const restore = hideInternalCommands(commands)
    const later = () => [{ name: 'later' }]
    commands.list = later as never
    restore()
    expect(commands.list({})).toEqual([{ name: 'later' }])
  })
})

function makeCommands() {
  const defs = new Map<string, any>()
  return {
    defs,
    ctx: {
      commands: {
        register: (definition: any) => {
          defs.set(definition.name, definition)
          return () => { defs.delete(definition.name) }
        },
      },
    },
  }
}

function invocation(rawInput: string) {
  return {
    rawInput,
    agent: { id: 'parent-1', session: { header: { id: 'parent-1' } } },
    signal: new AbortController().signal,
    commandId: 'cmd',
    attachments: [],
  }
}

describe('quietInternalCommands', () => {
  it('drops only the lifecycle pair of an internal command', () => {
    const append = vi.fn()
    const commands = {
      list: (_agent: unknown) => [],
      appendLifecycle: append,
    }
    const restore = quietInternalCommands(commands)
    commands.appendLifecycle({}, 'command/run', { name: ASK_COMMAND, commandId: 'internal-1' })
    commands.appendLifecycle({}, 'command/done', { commandId: 'internal-1' })
    expect(append).not.toHaveBeenCalled()
    commands.appendLifecycle({}, 'command/run', { name: 'other', commandId: 'other-1' })
    commands.appendLifecycle({}, 'command/done', { commandId: 'other-1' })
    expect(append).toHaveBeenCalledTimes(2)
    restore()
    commands.appendLifecycle({}, 'command/run', { name: ASK_COMMAND, commandId: 'internal-2' })
    expect(append).toHaveBeenCalledTimes(3)
  })

  it('reports an unavailable lifecycle hook without failing', () => {
    const unsupported = vi.fn()
    const restore = quietInternalCommands({}, unsupported)
    expect(unsupported).toHaveBeenCalledTimes(1)
    expect(() => restore()).not.toThrow()
  })
})

describe('registerBtwCommands', () => {
  it('registers hidden commands and returns JSON', async () => {
    const { defs, ctx } = makeCommands()
    const engine = {
      ask: vi.fn(async () => ({
        topic: { id: TOPIC, parentSessionId: 'parent-1', title: 'Why?', createdAt: 1, updatedAt: 1, turns: [] },
        turn: { id: TURN, question: 'Why?', answer: '', status: 'running', createdAt: 1, updatedAt: 1 },
      })),
      list: vi.fn(() => []),
      get: vi.fn(),
      cancel: vi.fn(),
      delete: vi.fn(),
    }
    const disposers = registerBtwCommands(ctx as never, engine as never)
    expect(defs.has(ASK_COMMAND)).toBe(true)
    expect(defs.has(LIST_COMMAND)).toBe(true)
    const ask = defs.get(ASK_COMMAND)
    expect(ask.recordInput).toBe(false)
    const result = await ask.handler(invocation(JSON.stringify({ turnId: TURN, question: 'Why?', locale: 'en' })))
    expect(result.kind).toBe('success')
    expect(JSON.parse(result.text)).toMatchObject({ turn: { id: TURN } })

    const list = await defs.get(LIST_COMMAND).handler(invocation(''))
    expect(list.kind).toBe('success')
    expect(JSON.parse(list.text)).toEqual({ topics: [] })
    for (const dispose of disposers) dispose()
    expect(defs.size).toBe(0)
  })

  it('returns an error result instead of throwing', async () => {
    const { defs, ctx } = makeCommands()
    const engine = { ask: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), delete: vi.fn() }
    registerBtwCommands(ctx as never, engine as never)
    const result = await defs.get(ASK_COMMAND).handler(invocation('{'))
    expect(result.kind).toBe('error')
    expect(result.text).toMatch(/valid JSON/i)
  })
})

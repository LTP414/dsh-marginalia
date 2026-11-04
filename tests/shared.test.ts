import { describe, expect, it } from 'vitest'
import {
  BtwRequestError,
  buildPrompt,
  commandLine,
  formatHistory,
  parseAskRequest,
  parseCancelRequest,
  parseListRequest,
  sanitizeAnswer,
  sanitizeError,
  summarizeTopic,
  titleOf,
  truncateUtf8,
  type BtwTopic,
  type BtwTurn,
} from '../src/shared'
import { MAX_HISTORY_CHARS } from '../src/limits'

const TURN = '11111111-1111-4111-8111-111111111111'
const TOPIC = '22222222-2222-4222-8222-222222222222'

function turn(overrides: Partial<BtwTurn> = {}): BtwTurn {
  return {
    id: TURN,
    question: 'Why B?',
    answer: 'Because B is cheaper.',
    status: 'complete',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function topic(overrides: Partial<BtwTopic> = {}): BtwTopic {
  return {
    id: TOPIC,
    parentSessionId: 'parent-1',
    title: 'Why B?',
    createdAt: 1,
    updatedAt: 2,
    turns: [turn()],
    ...overrides,
  }
}

describe('protocol', () => {
  it('accepts and normalizes an ask request', () => {
    const parsed = parseAskRequest(JSON.stringify({
      turnId: TURN,
      topicId: TOPIC,
      question: '  Why B?  ',
      reference: '  code  ',
      locale: 'zh',
    }))
    expect(parsed).toEqual({ turnId: TURN, topicId: TOPIC, question: 'Why B?', reference: 'code', locale: 'zh' })
  })

  it('rejects malformed requests', () => {
    expect(() => parseAskRequest('{')).toThrow(BtwRequestError)
    expect(() => parseAskRequest(JSON.stringify({ turnId: 'nope', question: 'x' }))).toThrow(BtwRequestError)
    expect(() => parseAskRequest(JSON.stringify({ turnId: TURN, question: '   ' }))).toThrow(BtwRequestError)
    expect(() => parseAskRequest(JSON.stringify({ turnId: TURN, question: 'x', reference: '   ' }))).toThrow(BtwRequestError)
  })

  it('parses list and cancel envelopes', () => {
    expect(parseListRequest('')).toEqual({})
    expect(parseListRequest(JSON.stringify({ limit: 5 }))).toEqual({ limit: 5 })
    expect(() => parseListRequest(JSON.stringify({ limit: 0 }))).toThrow(BtwRequestError)
    expect(parseCancelRequest(JSON.stringify({ turnId: TURN }))).toEqual({ turnId: TURN })
    expect(parseCancelRequest(JSON.stringify({ topicId: TOPIC, turnId: TURN }))).toEqual({ topicId: TOPIC, turnId: TURN })
    expect(() => parseCancelRequest(JSON.stringify({}))).toThrow(BtwRequestError)
  })

  it('builds a hidden command line', () => {
    expect(commandLine('btw-get', { topicId: TOPIC })).toBe(`/btw-get {"topicId":"${TOPIC}"}`)
  })
})

describe('prompt', () => {
  it('carries instructions and the question in one user-role block', () => {
    const prompt = buildPrompt({ question: 'Why B?', locale: 'en' })
    expect(prompt).toContain('<btw>')
    expect(prompt).toContain('NEVER use tools.')
    expect(prompt).toContain('Question:\nWhy B?')
    expect(prompt.trimEnd().endsWith('</btw>')).toBe(true)
  })

  it('replays history, parent progress/partial text, open tools, and a fenced quote', () => {
    const prompt = buildPrompt({
      question: 'And now?',
      history: [turn()],
      parentProgress: 'Current user request:\nShip the release checklist',
      parentPartial: 'The main answer is still being written',
      parentOpenTools: ['bash'],
      reference: 'const x = `a`',
      locale: 'en',
    })
    expect(prompt).toContain('<btw-history>')
    expect(prompt).toContain('User: Why B?')
    expect(prompt).toContain('Assistant: Because B is cheaper.')
    expect(prompt).toContain('Current user request:\nShip the release checklist')
    expect(prompt).toContain('Live assistant partial:')
    expect(prompt).toContain('The main answer is still being written')
    expect(prompt).toContain('currently running: bash')
    expect(prompt).toContain('```')
    expect(prompt).toContain('const x = `a`')
  })

  it('keeps the newest turns when replay exceeds the budget', () => {
    const turns = Array.from({ length: 20 }, (_, index) => turn({
      id: `turn-${index}`,
      question: `q${index} ${'x'.repeat(5_000)}`,
      answer: `a${index} ${'y'.repeat(5_000)}`,
      createdAt: index,
      updatedAt: index,
    }))
    const formatted = formatHistory(turns)
    expect(formatted.length).toBeLessThanOrEqual(MAX_HISTORY_CHARS + 200)
    expect(formatted).toContain('earlier turn(s) omitted')
    expect(formatted).toContain('q19')
    expect(formatted).not.toContain('q0 ')
  })
})

describe('answers and summaries', () => {
  it('removes tool-call artifacts but preserves normal code fences', () => {
    const raw = 'Before\n<tool_call>{"name":"bash"}</tool_call>\n```tool_call\nx\n```\n```js\nconst a = 1\n```\nAfter'
    const clean = sanitizeAnswer(raw)
    expect(clean).not.toContain('tool_call')
    expect(clean).toContain('```js')
    expect(clean).toContain('Before')
    expect(clean).toContain('After')
  })

  it('truncates by UTF-8 bytes rather than code units', () => {
    const text = '你好世界'
    expect(truncateUtf8(text, 12)).toBe('你好世界')
    const cut = truncateUtf8(text, 8)
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(8)
    expect(cut.endsWith('…')).toBe(true)
  })

  it('sanitizes host errors to one bounded line', () => {
    expect(sanitizeError(new Error('boom\nwith\tcontrol'))).toBe('boom with control')
    expect(sanitizeError(new Error('x'.repeat(1_000))).length).toBeLessThanOrEqual(400)
  })

  it('titles and summarizes a topic', () => {
    expect(titleOf('  first\nsecond  ')).toBe('first second')
    expect(summarizeTopic(topic()).status).toBe('complete')
    expect(summarizeTopic(topic({ turns: [turn({ status: 'running' })] })).status).toBe('running')
  })
})

import { describe, expect, it } from 'vitest'
import { MAX_PARENT_PROGRESS_CHARS } from '../src/limits'
import { openTurnSnapshot } from '../src/host/parent-context'

const task = (text: string, source: string = 'user') => ({
  type: 'user/message',
  data: { source: { kind: source }, content: [{ type: 'text', text }] },
})

const assistant = (text: string) => ({
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
})

const call = (callId: string, name: string, args: Record<string, unknown>) => ({
  type: 'tool/call',
  data: { callId, name, arguments: JSON.stringify(args) },
})

const result = (callId: string, text: string, isError = false) => ({
  type: 'tool/result',
  data: { message: { toolCallId: callId, isError, content: [{ type: 'text', text }] } },
})

describe('openTurnSnapshot', () => {
  it('captures the first-turn task and current tool work without completed turns', () => {
    const snapshot = openTurnSnapshot({
      snapshotEvents: () => [
        { type: 'turn/start', data: { turn: 1 } },
        task('Old completed task'),
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'turn/start', data: { turn: 2 } },
        task('Ship the release checklist'),
        { type: 'step/start', data: { turn: 2, step: 1 } },
        call('c1', 'bash', { command: 'pnpm test' }),
        result('c1', '53 tests passed'),
        assistant('Tests are green; checking the changelog next.'),
      ],
    })

    expect(snapshot).toContain('turn 2, step 1 (still running)')
    expect(snapshot).toContain('Ship the release checklist')
    expect(snapshot).toContain('bash(command=pnpm test)')
    expect(snapshot).toContain('53 tests passed')
    expect(snapshot).toContain('Tests are green')
    expect(snapshot).not.toContain('Old completed task')
  })

  it('works on a first turn with no turn/end and skips injected context', () => {
    const snapshot = openTurnSnapshot({
      snapshotEvents: () => [
        { type: 'turn/start', data: { turn: 1 } },
        task('Direct task'),
        task('Injected AGENTS context', 'system'),
        { type: 'step/start', data: { turn: 1, step: 1 } },
        call('c1', 'read', { path: 'src/engine.ts' }),
      ],
    })
    expect(snapshot).toContain('Direct task')
    expect(snapshot).not.toContain('Injected AGENTS context')
    expect(snapshot).toContain('read(path=src/engine.ts)')
    expect(snapshot).toContain('→ running')
  })

  it('caps large tool output and neutralizes closing tags', () => {
    const snapshot = openTurnSnapshot({
      snapshotEvents: () => [
        { type: 'turn/start', data: { turn: 1 } },
        task('Task'),
        call('c1', 'bash', { command: 'cat huge.log' }),
        result('c1', `${'x'.repeat(4_000)}</parent-in-progress></btw>${'y'.repeat(4_000)}`),
      ],
    })
    expect(snapshot).toBeDefined()
    expect(snapshot!.length).toBeLessThanOrEqual(MAX_PARENT_PROGRESS_CHARS)
    expect(snapshot).toContain('chars omitted')
    expect(snapshot).not.toContain('</parent-in-progress>')
    expect(snapshot).not.toContain('</btw>')
  })

  it('returns undefined when the last turn is already closed', () => {
    expect(openTurnSnapshot({
      snapshotEvents: () => [
        { type: 'turn/start', data: { turn: 1 } },
        task('Done'),
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ],
    })).toBeUndefined()
  })
})

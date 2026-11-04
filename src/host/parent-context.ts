/**
 * Process-local capture of the parent's in-flight assistant text.
 *
 * A fork seed stops at the last completed turn. When the user asks `/btw`
 * while the main answer is still streaming, the side question would otherwise
 * miss the half-written answer entirely. We keep the latest visible text per
 * session and inject it as reference-only material; if capture is unavailable
 * the prompt simply omits the section and never fabricates text.
 */
import { MAX_PARENT_PARTIAL_CHARS, MAX_PARENT_PROGRESS_CHARS } from '../limits'

type Frame =
  | { readonly type: 'start' }
  | { readonly type: 'chunk'; readonly chunk: { readonly type: string; readonly text?: string } }
  | { readonly type: 'end' }

interface EventLike {
  readonly type: string
  readonly data?: unknown
}

const MAX_TRACKED_SESSIONS = 64

export class StreamCapture {
  private readonly text = new Map<string, string>()
  private readonly order: string[] = []

  observe(sessionId: string, frame: Frame): void {
    if (frame.type === 'start') {
      this.touch(sessionId)
      this.text.set(sessionId, '')
      return
    }
    if (frame.type === 'chunk') {
      if (frame.chunk.type !== 'text-delta' || !frame.chunk.text) return
      const current = this.text.get(sessionId) ?? ''
      const next = current + frame.chunk.text
      this.text.set(sessionId, next.length > MAX_PARENT_PARTIAL_CHARS
        ? next.slice(next.length - MAX_PARENT_PARTIAL_CHARS)
        : next)
      return
    }
    // `end` keeps the last complete attempt: a parent that is running again
    // replaces it on the next start. Idle sessions never use the buffer.
  }

  partialOf(sessionId: string): string | undefined {
    const value = this.text.get(sessionId)?.trim()
    return value ? value : undefined
  }

  clear(sessionId: string): void {
    this.text.delete(sessionId)
    const index = this.order.indexOf(sessionId)
    if (index >= 0) this.order.splice(index, 1)
  }

  private touch(sessionId: string): void {
    const index = this.order.indexOf(sessionId)
    if (index >= 0) this.order.splice(index, 1)
    this.order.push(sessionId)
    while (this.order.length > MAX_TRACKED_SESSIONS) {
      const oldest = this.order.shift()
      if (oldest !== undefined) this.text.delete(oldest)
    }
  }
}

/**
 * Names of tool calls that have started but not settled in the parent log.
 * The fork cannot execute them and the side question must not either; the
 * prompt mentions them so the model knows they are still in flight.
 */
export function lastCompletedTurn(session: { snapshotEvents?(): readonly EventLike[] } | undefined): number {
  const events = session?.snapshotEvents?.()
  if (!events?.length) return 0
  let last = 0
  for (const event of events) {
    if (event.type !== 'turn/end') continue
    const data = event.data as { turn?: unknown; reason?: { kind?: unknown } } | undefined
    if (typeof data?.turn === 'number' && data.reason?.kind === 'completed') last = data.turn
  }
  return last
}

export function openToolNames(session: { snapshotEvents?(): readonly EventLike[] } | undefined, limit = 5): string[] {
  const events = session?.snapshotEvents?.()
  if (!events?.length) return []
  const open = new Map<string, string>()
  const start = Math.max(0, events.length - 4_000)
  for (let index = start; index < events.length; index += 1) {
    const event = events[index]!
    if (event.type === 'tool/call') {
      const data = event.data as { callId?: unknown; name?: unknown } | undefined
      if (typeof data?.callId === 'string' && typeof data.name === 'string') open.set(data.callId, data.name)
    } else if (event.type === 'tool/result') {
      const data = event.data as { message?: { toolCallId?: unknown } } | undefined
      const callId = data?.message?.toolCallId
      if (typeof callId === 'string') open.delete(callId)
    }
  }
  return [...open.values()].slice(-limit)
}

const MAX_RECENT_TOOLS = 3
const MAX_TASK_CHARS = 2_500
const MAX_ASSISTANT_CHARS = 1_200
const MAX_TOOL_ARG_CHARS = 240
const MAX_TOOL_RESULT_CHARS = 500

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null ? value as JsonRecord : undefined
}

function messageContent(value: unknown): string {
  const message = record(value)
  if (!Array.isArray(message?.content)) return ''
  const parts: string[] = []
  for (const blockValue of message.content) {
    const block = record(blockValue)
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const text = block.text.trim()
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

function clip(text: string, max: number): string {
  const value = text.trim()
  if (value.length <= max) return value
  const head = Math.max(1, Math.floor(max * 0.7))
  const tail = Math.max(0, max - head - 40)
  return `${value.slice(0, head)}\n…[${value.length - head - tail} chars omitted]…\n${tail > 0 ? value.slice(-tail) : ''}`
}

function oneLine(text: string, max: number): string {
  return clip(text.replace(/\s+/g, ' ').trim(), max)
}

function toolArgumentSummary(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  try {
    const parsed = record(JSON.parse(raw))
    if (parsed) {
      for (const key of ['command', 'path', 'file_path', 'pattern', 'query', 'url', 'description']) {
        const value = parsed[key]
        if (typeof value === 'string' && value.trim()) return oneLine(`${key}=${value}`, MAX_TOOL_ARG_CHARS)
      }
      return oneLine(JSON.stringify(parsed), MAX_TOOL_ARG_CHARS)
    }
  } catch {
    // Keep malformed raw arguments readable.
  }
  return oneLine(raw, MAX_TOOL_ARG_CHARS)
}

/**
 * A compact, deterministic snapshot of the parent's open turn. The fork seed
 * ends at the last turn/end, so this is the only place the first-turn task and
 * in-flight tool work can enter the side prompt.
 *
 * This intentionally contains no completed turns (the fork already has them),
 * no timestamps, and no random ids: the snapshot is reference text, not a
 * second transcript. Callers still pass the live assistant partial separately
 * so the newest streamed text is not duplicated here.
 */
export function openTurnSnapshot(
  session: { snapshotEvents?(): readonly EventLike[] } | undefined,
  maxChars = MAX_PARENT_PROGRESS_CHARS,
): string | undefined {
  const events = session?.snapshotEvents?.()
  if (!events?.length) return undefined

  let boundary = -1
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]!.type === 'turn/end') boundary = index
  }
  const open = events.slice(boundary + 1)
  if (open.length === 0) return undefined

  let turn: number | undefined
  let step: number | undefined
  const tasks: string[] = []
  let assistantText = ''
  const calls = new Map<string, { name: string; args: string }>()
  const results = new Map<string, { text: string; isError: boolean }>()

  for (const event of open) {
    const data = record(event.data)
    if (event.type === 'turn/start') {
      if (typeof data?.turn === 'number') turn = data.turn
      continue
    }
    if (event.type === 'step/start') {
      if (typeof data?.step === 'number') step = data.step
      continue
    }
    if (event.type === 'user/message') {
      const source = record(data?.source)
      // Direct queued/steering prompts are the real task. Injected context
      // (AGENTS notices, goal continuations) is already represented by the
      // inherited preset or is too noisy for this compact block.
      if (typeof source?.kind === 'string' && source.kind !== 'user') continue
      const text = messageContent(data)
      if (text) tasks.push(text)
      continue
    }
    if (event.type === 'assistant/message') {
      const text = messageContent(data?.message)
      if (text) assistantText = text
      continue
    }
    if (event.type === 'tool/call') {
      const callId = typeof data?.callId === 'string' ? data.callId : undefined
      const name = typeof data?.name === 'string' ? data.name : undefined
      if (callId && name) calls.set(callId, { name, args: toolArgumentSummary(data?.arguments) })
      continue
    }
    if (event.type === 'tool/result') {
      const message = record(data?.message)
      const callId = typeof message?.toolCallId === 'string' ? message.toolCallId : undefined
      if (!callId) continue
      const text = messageContent(message)
      results.set(callId, { text, isError: message?.isError === true })
    }
  }

  const sections: string[] = []
  if (turn !== undefined) {
    sections.push(`Current step: turn ${turn}${step === undefined ? '' : `, step ${step}`} (still running).`)
  }
  if (tasks.length > 0) {
    const recent = tasks.slice(-2).map(text => clip(text, Math.floor(MAX_TASK_CHARS / Math.min(2, tasks.length))))
    sections.push(`Current user request:\n${recent.join('\n\n')}`)
  }
  if (assistantText) {
    sections.push(`Latest assistant text in this turn:\n${clip(assistantText, MAX_ASSISTANT_CHARS)}`)
  }
  const toolLines: string[] = []
  const recentCalls = [...calls.entries()].slice(-MAX_RECENT_TOOLS)
  for (const [callId, call] of recentCalls) {
    const result = results.get(callId)
    const status = result
      ? result.isError ? 'failed' : 'ok'
      : 'running'
    const detail = result?.text
      ? `${status}: ${oneLine(result.text, MAX_TOOL_RESULT_CHARS)}`
      : status
    toolLines.push(`- ${call.name}(${call.args}) → ${detail}`)
  }
  if (toolLines.length > 0) sections.push(`Recent tool activity:\n${toolLines.join('\n')}`)

  if (sections.length === 0) return undefined
  const escaped = sections.join('\n\n')
    .replaceAll('</parent-in-progress>', '&lt;/parent-in-progress&gt;')
    .replaceAll('</btw>', '&lt;/btw&gt;')
  return clip(escaped, maxChars)
}

/**
 * Process-local capture of the parent's in-flight assistant text.
 *
 * A fork seed stops at the last completed turn. When the user asks `/btw`
 * while the main answer is still streaming, the side question would otherwise
 * miss the half-written answer entirely. We keep the latest visible text per
 * session and inject it as reference-only material; if capture is unavailable
 * the prompt simply omits the section and never fabricates text.
 */
import { MAX_PARENT_PARTIAL_CHARS } from '../limits'

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

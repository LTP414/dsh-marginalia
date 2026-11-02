/**
 * The side-question engine.
 *
 * One active job per parent session. A job reserves the child id before the
 * fork starts, arms the execution-time guard, appends one user-role prompt to
 * the inherited prefix, and records exactly one durable turn. Follow-ups are
 * new children under the same topic so they always see the parent as it is
 * *now* rather than a snapshot frozen when the panel opened.
 */
import {
  DEFAULT_TIMEOUT_MS,
  CLEANUP_TIMEOUT_MS,
  MAX_ACTIVE_BTW,
  MAX_SIDE_OUTPUT_TOKENS,
  MAX_TURNS_PER_TOPIC,
} from '../limits'
import {
  buildPrompt,
  sanitizeAnswer,
  sanitizeError,
  summarizeTopic,
  titleOf,
  type AskAccepted,
  type AskRequest,
  type BtwStatus,
  type BtwTopic,
  type BtwTopicSummary,
  type BtwTurn,
} from '../shared'
import { randomId } from '../random'
import { lastCompletedTurn, openToolNames, type StreamCapture } from './parent-context'
import type { ChildGuard } from './tool-guard'
import type { BtwStore } from './store'

export interface ParentAgent {
  readonly id: string
  readonly status: 'idle' | 'running'
  readonly options?: { readonly maxTokens?: number }
  readonly session?: {
    readonly header?: { readonly origin?: string }
    snapshotEvents?(): readonly { readonly type: string; readonly data?: unknown }[]
  }
}

export interface ChildOutputBlock {
  readonly type: string
  readonly text?: string
}

export interface ChildResult {
  readonly stopReason: string
  readonly output: readonly ChildOutputBlock[]
  readonly diagnostic?: string
}

export interface ChildHandle {
  readonly result: Promise<ChildResult>
  dispose(): Promise<void>
}

export interface StartChildRequest {
  readonly parent: ParentAgent
  readonly childId: string
  readonly prompt: string
  readonly signal: AbortSignal
  readonly maxTokens: number
  readonly label: string
}

export interface BtwEngineOptions {
  readonly store: BtwStore
  readonly startChild: (request: StartChildRequest) => Promise<ChildHandle>
  readonly guard: ChildGuard
  readonly capture: StreamCapture
  readonly now?: () => number
  readonly uuid?: () => string
  readonly timeoutMs?: number
  readonly cleanupTimeoutMs?: number
  readonly archiveChild?: (childId: string) => Promise<void>
  readonly log?: (message: string, error?: unknown) => void
}

export interface AskInput extends AskRequest {
  readonly parent: ParentAgent
}

type CancelReason = 'user' | 'timeout' | 'dispose'

interface ActiveJob {
  readonly parentId: string
  readonly topicId: string
  readonly turnId: string
  readonly childId: string
  readonly controller: AbortController
  cancelReason?: CancelReason
  starting?: Promise<ChildHandle>
  handle?: ChildHandle
  disposed?: boolean
  readonly done: Promise<void>
  finish(): void
  timer?: ReturnType<typeof setTimeout>
}

export class BtwBusyError extends Error {
  override name = 'BtwBusyError'
  constructor() { super('A side question is already running in this session.') }
}

export class BtwCapacityError extends Error {
  override name = 'BtwCapacityError'
  constructor() { super('Too many side questions are running. Try again shortly.') }
}

export class BtwNotFoundError extends Error {
  override name = 'BtwNotFoundError'
  constructor() { super('The side-question topic was not found.') }
}

export class BtwEngine {
  private readonly active = new Map<string, ActiveJob>()
  private readonly cancelledTurns = new Map<string, number>()
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly timeoutMs: number
  private readonly cleanupTimeoutMs: number
  private readonly log: (message: string, error?: unknown) => void
  private closed = false

  constructor(private readonly options: BtwEngineOptions) {
    this.now = options.now ?? Date.now
    this.uuid = options.uuid ?? randomId
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS
    this.log = options.log ?? (() => {})
  }

  get activeCount(): number { return this.active.size }

  hasActive(parentSessionId: string): boolean { return this.active.has(parentSessionId) }

  async ask(input: AskInput): Promise<AskAccepted> {
    if (this.closed) throw new Error('The side-question engine is stopping.')
    if (!input.turnId) throw new Error('Missing turn id.')
    if (input.parent.session?.header?.origin === 'subagent') {
      throw new Error('Side questions are only available in the main session.')
    }
    if (this.active.has(input.parent.id)) throw new BtwBusyError()
    if (this.active.size >= MAX_ACTIVE_BTW) throw new BtwCapacityError()
    if (this.options.guard.has(input.turnId)) throw new Error('Duplicate side-question id.')
    this.pruneCancelled()
    if (this.cancelledTurns.has(input.turnId)) throw new Error('This side question was cancelled before it started.')

    const previous = input.topicId === undefined ? undefined : this.options.store.get(input.parent.id, input.topicId)
    if (input.topicId !== undefined && previous === undefined) throw new BtwNotFoundError()
    if (previous !== undefined && previous.turns.length >= MAX_TURNS_PER_TOPIC) {
      throw new Error('This topic has reached its turn limit; start a new topic.')
    }

    const at = this.now()
    // A stale `running` inside an otherwise live process (for example a job
    // cleaned outside the engine) is not actionable; close it before appending.
    const history: readonly BtwTurn[] = previous === undefined
      ? []
      : previous.turns.map(turn => turn.status === 'running'
        ? { ...turn, status: 'interrupted' as BtwStatus, updatedAt: at }
        : turn)

    const turn: BtwTurn = {
      id: input.turnId,
      question: input.question,
      answer: '',
      status: 'running',
      ...(input.reference === undefined ? {} : { reference: input.reference }),
      createdAt: at,
      updatedAt: at,
      childSessionId: input.turnId,
    }
    const base: BtwTopic = previous === undefined
      ? {
          id: this.uuid(),
          parentSessionId: input.parent.id,
          title: titleOf(input.question),
          createdAt: at,
          updatedAt: at,
          turns: [],
        }
      : previous
    const topic: BtwTopic = {
      ...base,
      updatedAt: at,
      turns: [...history, turn],
    }
    await this.options.store.put(topic)

    const controller = new AbortController()
    let finishJob!: () => void
    const done = new Promise<void>((resolve) => { finishJob = resolve })
    const job: ActiveJob = {
      parentId: input.parent.id,
      topicId: topic.id,
      turnId: turn.id,
      childId: turn.id,
      controller,
      done,
      finish: finishJob,
      timer: setTimeout(() => {
        if (job.cancelReason !== undefined) return
        job.cancelReason = 'timeout'
        controller.abort(new Error('Side question timed out.'))
      }, this.timeoutMs),
    }
    job.timer?.unref?.()
    this.active.set(input.parent.id, job)
    const releaseId = this.options.guard.own(job.childId)

    try {
      const parentPartial = this.options.capture.partialOf(input.parent.id)
      const openTools = input.parent.status === 'running' ? openToolNames(input.parent.session) : []
      const prompt = buildPrompt({
        question: input.question,
        ...(input.reference === undefined ? {} : { reference: input.reference }),
        history,
        ...(parentPartial === undefined ? {} : { parentPartial }),
        ...(openTools.length === 0 ? {} : { parentOpenTools: openTools }),
        locale: input.locale,
      })
      const parentMax = input.parent.options?.maxTokens
      const maxTokens = typeof parentMax === 'number' && parentMax > 0
        ? Math.min(MAX_SIDE_OUTPUT_TOKENS, parentMax)
        : MAX_SIDE_OUTPUT_TOKENS
      const starting = this.options.startChild({
        parent: input.parent,
        childId: job.childId,
        prompt,
        signal: controller.signal,
        maxTokens,
        label: 'Marginalia',
      })
      job.starting = starting
      const handle = await starting
      job.starting = undefined
      job.handle = handle
      void this.settle(job, topic, turn, handle).catch((error) => {
        this.log('dsh-marginalia: settle failed.', error)
        if (this.active.get(job.parentId) === job) this.active.delete(job.parentId)
        job.finish()
      })
      return { topic, turn, baselineTurn: lastCompletedTurn(input.parent.session) }
    } catch (error) {
      if (job.timer) clearTimeout(job.timer)
      this.active.delete(job.parentId)
      job.finish()
      await releaseId()
      const cancelled = job.cancelReason === 'user' || job.cancelReason === 'dispose'
      const status: BtwStatus = cancelled ? 'cancelled' : 'error'
      const reason = job.cancelReason === 'dispose' ? 'The side question stopped with the plugin.' : sanitizeError(error)
      await this.updateTurn(topic, turn.id, {
        status,
        answer: this.options.capture.partialOf(job.childId) ?? '',
        ...(status === 'error' ? { error: reason } : {}),
      })
      throw error
    }
  }

  /** Run one child to completion and persist the canonical status. */
  private async settle(job: ActiveJob, topic: BtwTopic, turn: BtwTurn, handle: ChildHandle): Promise<void> {
    let result: ChildResult | undefined
    let failure: unknown
    try {
      result = await handle.result
    } catch (error) {
      failure = error
    }
    if (job.timer) clearTimeout(job.timer)

    const partial = this.options.capture.partialOf(job.childId) ?? ''
    let status: BtwStatus
    let answer = ''
    let error: string | undefined

    if (job.cancelReason === 'dispose') {
      status = 'interrupted'
      answer = partial
    } else if (job.cancelReason === 'user') {
      status = 'cancelled'
      answer = partial || textOf(result)
    } else if (job.cancelReason === 'timeout') {
      status = 'error'
      answer = partial || textOf(result)
      error = 'The side question timed out.'
    } else if (result === undefined) {
      status = 'error'
      error = sanitizeError(failure) || 'The side question failed.'
    } else if (result.stopReason === 'completed') {
      answer = sanitizeAnswer(textOf(result) || partial)
      status = answer ? 'complete' : 'error'
      if (!answer) error = 'The model returned no text.'
    } else if (result.stopReason === 'aborted') {
      answer = sanitizeAnswer(textOf(result) || partial)
      status = 'cancelled'
    } else {
      answer = sanitizeAnswer(textOf(result) || partial)
      status = 'error'
      error = describeStop(result)
    }

    try {
      await this.updateTurn(topic, turn.id, {
        status,
        answer: sanitizeAnswer(answer),
        ...(error === undefined ? {} : { error }),
      })
    } catch (updateError) {
      this.log('dsh-marginalia: failed to persist side-question result.', updateError)
    }

    if (!job.disposed) {
      job.disposed = true
      try {
        await this.bounded(handle.dispose(), 'dispose')
      } catch (cleanupError) {
        this.log('dsh-marginalia: failed to dispose side-question child.', cleanupError)
      }
    }
    try {
      await this.options.guard.release(job.childId)
    } catch (guardError) {
      this.log('dsh-marginalia: failed to release side-question guard.', guardError)
    }
    if (this.options.archiveChild) {
      try {
        await this.bounded(this.options.archiveChild(job.childId), 'archive')
      } catch (archiveError) {
        this.log('dsh-marginalia: child session could not be archived.', archiveError)
      }
    }
    this.options.capture.clear(job.childId)
    if (this.active.get(job.parentId) === job) this.active.delete(job.parentId)
    job.finish()
  }

  list(parentSessionId: string, limit?: number): BtwTopicSummary[] {
    return this.options.store.list(parentSessionId, limit)
  }

  get(parentSessionId: string, topicId: string): BtwTopic {
    const topic = this.options.store.get(parentSessionId, topicId)
    if (!topic) throw new BtwNotFoundError()
    return topic
  }

  async cancel(parentSessionId: string, topicId?: string, turnId?: string): Promise<void> {
    const job = this.active.get(parentSessionId)
    if (!job || (topicId !== undefined && job.topicId !== topicId) || (turnId !== undefined && job.turnId !== turnId)) {
      // Close can arrive before the ask RPC creates its job. Remember the turn
      // id so a late ask cannot resurrect a bubble the user already dismissed.
      if (turnId !== undefined) this.cancelledTurns.set(turnId, this.now())
      this.pruneCancelled()
      return
    }
    job.cancelReason = 'user'
    job.controller.abort(new Error('Side question cancelled by the user.'))
    if (job.starting) {
      try { await this.bounded(job.starting.then(() => undefined, () => undefined), 'cancel') }
      catch (error) { this.log('dsh-marginalia: cancel startup wait failed.', error) }
    }
    if (job.handle && !job.disposed) {
      job.disposed = true
      try { await this.bounded(job.handle.dispose(), 'dispose') }
      catch (error) { this.log('dsh-marginalia: cancel cleanup failed.', error) }
    }
    try { await this.bounded(job.done, 'cancel') }
    catch (error) { this.log('dsh-marginalia: cancel settlement failed.', error) }
  }

  async delete(parentSessionId: string, topicId: string): Promise<boolean> {
    await this.cancel(parentSessionId, topicId)
    return this.options.store.delete(parentSessionId, topicId)
  }

  private pruneCancelled(): void {
    const cutoff = this.now() - 5 * 60_000
    for (const [turnId, at] of this.cancelledTurns) {
      if (at < cutoff) this.cancelledTurns.delete(turnId)
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const job of this.active.values()) {
      job.cancelReason = 'dispose'
      job.controller.abort(new Error('The side-question plugin is stopping.'))
    }
    await Promise.allSettled([...this.active.values()].map(async job => {
      if (job.starting) {
        try { await this.bounded(job.starting.then(() => undefined, () => undefined), 'dispose') }
        catch (error) { this.log('dsh-marginalia: startup cleanup failed.', error) }
      }
      await this.bounded(job.done, 'dispose')
    }))
    await this.options.guard.releaseAll()
    try { await this.options.store.markInterrupted() }
    catch (error) { this.log('dsh-marginalia: could not mark interrupted topics.', error) }
  }

  private async updateTurn(topic: BtwTopic, turnId: string, patch: Partial<BtwTurn>): Promise<void> {
    const current = this.options.store.get(topic.parentSessionId, topic.id)
    if (!current) return
    const at = this.now()
    const turns = current.turns.map(turn => turn.id === turnId
      ? { ...turn, ...patch, updatedAt: at }
      : turn)
    await this.options.store.put({ ...current, turns, updatedAt: at })
  }

  private bounded<T>(promise: Promise<T>, _phase: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Cleanup timed out.')), this.cleanupTimeoutMs)
      timer.unref?.()
    })
    return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer) })
  }
}

function textOf(result: ChildResult | undefined): string {
  if (!result) return ''
  return result.output
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('')
    .trim()
}

function describeStop(result: ChildResult): string {
  if (result.stopReason === 'max-tokens') return 'The answer reached the output token limit.'
  if (result.stopReason === 'refusal') return 'The model refused to answer.'
  if (result.stopReason === 'error') {
    return sanitizeError(result.diagnostic ?? 'The side question failed.')
  }
  return sanitizeError(result.diagnostic ?? `The side question ended with "${result.stopReason}".`)
}

export { summarizeTopic }

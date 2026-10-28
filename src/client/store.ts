/**
 * Client-side state machine for Marginalia.
 *
 * The Host owns durability and the child fork. This store owns only ephemeral
 * bubbles, the attached child window, and the history panel. Every mutation
 * publishes one immutable snapshot so React can consume it with
 * `useSyncExternalStore`.
 */
import { MAX_QUESTION_LENGTH, MAX_REFERENCE_LENGTH } from '../limits'
import {
  ASK_COMMAND,
  CANCEL_COMMAND,
  DELETE_COMMAND,
  GET_COMMAND,
  LIST_COMMAND,
  cleanHostError,
  summarizeTopic,
  type AskAccepted,
  type BtwStatus,
  type BtwTopic,
  type BtwTopicSummary,
  type GetResult,
  type ListResult,
} from '../shared'
import type { TranslateFn } from './locales'

export type BubbleStatus = BtwStatus | 'starting'

export interface Bubble {
  readonly id: string
  readonly sessionId: string
  readonly topicId: string | null
  readonly question: string
  readonly reference?: string
  readonly answer: string
  readonly status: BubbleStatus
  readonly error?: string
  readonly childId?: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly collapsed: boolean
  readonly streaming: boolean
}

export interface HistoryState {
  readonly open: boolean
  readonly sessionId: string
  readonly topics: readonly BtwTopicSummary[]
  readonly selectedId?: string
  readonly topic?: BtwTopic
  readonly loading: boolean
  readonly loadingTopic: boolean
  readonly error?: string
}

export interface MarginaliaSnapshot {
  readonly bubbles: readonly Bubble[]
  readonly history: HistoryState | null
}

export interface Bridge {
  call(sessionId: string, name: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
}

interface SessionSnapshotLike {
  readonly running?: boolean
  readonly subagent?: unknown
  readonly removed?: boolean
  readonly openState?: string
}

export interface SessionFaceLike {
  getSnapshot(): SessionSnapshotLike
  subscribe(listener: () => void): () => void
}

export interface SessionReferenceLike {
  readonly sessionId: string
  readonly ready: Promise<unknown>
  readonly binding: { readonly session: SessionFaceLike }
  release(): void
}

export interface SessionsLike {
  retain(id: string, options: { source: string }): SessionReferenceLike
  binding(id: string): { readonly session: SessionFaceLike } | undefined
}

interface ChatSnapshotLike {
  readonly legacy?: {
    readonly partial?: { readonly blocks?: readonly AssistantBlockLike[] } | null
    readonly nodes?: readonly NodeLike[]
  }
  readonly nodes?: { values?(): readonly NodeLike[] }
}

interface NodeLike {
  readonly kind?: string
  readonly blocks?: readonly AssistantBlockLike[]
  readonly message?: string
  readonly error?: string
}

interface AssistantBlockLike {
  readonly kind?: string
  readonly text?: string
}

export interface ConversationLike {
  binding(binding: unknown): {
    target(name: 'chat'): {
      getSnapshot(): ChatSnapshotLike | undefined
      subscribe(listener: () => void): () => void
    }
  }
}

export interface StoreOptions {
  readonly bridge: Bridge
  readonly sessions?: SessionsLike
  readonly conversation?: ConversationLike
  readonly t: TranslateFn
  readonly uuid?: () => string
  readonly now?: () => number
  readonly source?: string
  readonly locale?: () => 'zh' | 'en'
  readonly maxBubblesPerSession?: number
  readonly log?: (message: string, error?: unknown) => void
}

interface Watcher {
  readonly bubbleId: string
  ref?: SessionReferenceLike
  offSession?: () => void
  offChat?: () => void
  released: boolean
  finalizing: boolean
  finalizeAttempts: number
  retryTimer?: ReturnType<typeof setTimeout>
}

const EMPTY_HISTORY: HistoryState = {
  open: false,
  sessionId: '',
  topics: [],
  loading: false,
  loadingTopic: false,
}

export class MarginaliaStore {
  private snapshot: MarginaliaSnapshot = { bubbles: [], history: null }
  private readonly listeners = new Set<() => void>()
  private readonly watchers = new Map<string, Watcher>()
  private readonly cancelled = new Set<string>()
  private readonly pending = new Map<string, AbortController>()
  private readonly historyControllers = new Set<AbortController>()
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly source: string
  private readonly maxBubbles: number
  private readonly log: (message: string, error?: unknown) => void
  private disposed = false

  constructor(private readonly options: StoreOptions) {
    this.now = options.now ?? Date.now
    this.uuid = options.uuid ?? (() => globalThis.crypto.randomUUID())
    this.source = options.source ?? 'dsh-marginalia'
    this.maxBubbles = options.maxBubblesPerSession ?? 6
    this.log = options.log ?? (() => {})
  }

  getSnapshot = (): MarginaliaSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  get t(): TranslateFn { return this.options.t }

  canAsk(sessionId: string): string | undefined {
    const binding = this.options.sessions?.binding(sessionId)
    if (!binding) return undefined
    try {
      const state = binding.session.getSnapshot()
      if (state.subagent) return this.options.t('error.subagent')
      if (state.removed) return this.options.t('error.backend')
    } catch {
      return undefined
    }
    return undefined
  }

  /**
   * Start one side question. Validation throws synchronously so the input
   * claim can report a composer error; Host failures land in the bubble.
   */
  ask(sessionId: string, question: string, options: { topicId?: string; reference?: string } = {}): string {
    if (this.disposed) throw new Error(this.options.t('error.backend'))
    const text = question.trim()
    if (!text) throw new Error(this.options.t('error.empty'))
    if (text.length > MAX_QUESTION_LENGTH) throw new Error(this.options.t('error.length'))
    const reference = options.reference?.trim()
    if (reference !== undefined && reference.length > MAX_REFERENCE_LENGTH) throw new Error(this.options.t('error.length'))
    const subagent = this.canAsk(sessionId)
    if (subagent) throw new Error(subagent)
    if (this.snapshot.bubbles.some(bubble => bubble.sessionId === sessionId
      && (bubble.status === 'starting' || bubble.status === 'running'))) {
      throw new Error(this.options.t('error.busy'))
    }

    const id = this.uuid()
    const at = this.now()
    const bubble: Bubble = {
      id,
      sessionId,
      topicId: options.topicId ?? null,
      question: text,
      answer: '',
      status: 'starting',
      ...(reference === undefined || reference === '' ? {} : { reference }),
      createdAt: at,
      updatedAt: at,
      collapsed: false,
      streaming: false,
    }
    const bubbles = this.makeRoom([...this.snapshot.bubbles, bubble], sessionId)
    this.publish({ ...this.snapshot, bubbles })
    const controller = new AbortController()
    this.pending.set(id, controller)
    void this.runAsk(bubble, reference, controller)
    return id
  }

  retry(bubbleId: string): void {
    const bubble = this.findBubble(bubbleId)
    if (!bubble || bubble.status === 'starting' || bubble.status === 'running') return
    void Promise.resolve().then(() => {
      try {
        this.ask(bubble.sessionId, bubble.question, bubble.topicId === null ? {} : { topicId: bubble.topicId })
      } catch (error) {
        this.update(bubbleId, { error: cleanHostError(error, this.options.t('error.generic')), status: 'error' })
      }
    })
  }

  async cancel(bubbleId: string): Promise<void> {
    const bubble = this.findBubble(bubbleId)
    if (!bubble) return
    this.cancelled.add(bubbleId)
    this.pending.get(bubbleId)?.abort()
    this.pending.delete(bubbleId)
    this.releaseWatcher(bubbleId)
    if (bubble.status === 'starting' && bubble.topicId === null) {
      this.update(bubbleId, { status: 'cancelled', streaming: false })
      try {
        await this.options.bridge.call(bubble.sessionId, CANCEL_COMMAND, { turnId: bubble.id })
      } catch (error) {
        this.log('marginalia: cancel-before-accept failed.', error)
      }
      return
    }
    this.update(bubbleId, { status: 'cancelled', streaming: false, error: undefined })
    try {
      await this.options.bridge.call(bubble.sessionId, CANCEL_COMMAND, {
        ...(bubble.topicId === null ? {} : { topicId: bubble.topicId }),
        turnId: bubble.id,
      })
    } catch (error) {
      this.update(bubbleId, { error: cleanHostError(error, this.options.t('error.cancel')) })
    }
  }

  dismiss(bubbleId: string): void {
    const bubble = this.findBubble(bubbleId)
    if (!bubble) return
    this.cancelled.add(bubbleId)
    if (bubble.status === 'starting' || bubble.status === 'running') void this.cancel(bubbleId)
    this.pending.delete(bubbleId)
    this.releaseWatcher(bubbleId)
    this.publish({ ...this.snapshot, bubbles: this.snapshot.bubbles.filter(item => item.id !== bubbleId) })
  }

  toggleCollapse(bubbleId: string): void {
    const bubble = this.findBubble(bubbleId)
    if (bubble) this.update(bubbleId, { collapsed: !bubble.collapsed })
  }

  async openHistory(sessionId: string): Promise<void> {
    if (this.disposed) return
    const current = this.snapshot.history
    if (current?.open && current.sessionId === sessionId) {
      await this.refreshHistory()
      return
    }
    this.publish({
      ...this.snapshot,
      history: { ...EMPTY_HISTORY, open: true, sessionId, loading: true },
    })
    await this.loadTopics(sessionId, true)
  }

  closeHistory(): void {
    for (const controller of this.historyControllers) controller.abort()
    this.historyControllers.clear()
    if (!this.snapshot.history) return
    this.publish({ ...this.snapshot, history: { ...this.snapshot.history, open: false } })
  }

  async refreshHistory(): Promise<void> {
    const history = this.snapshot.history
    if (!history) return
    await this.loadTopics(history.sessionId, false)
  }

  async selectTopic(topicId: string): Promise<void> {
    const history = this.snapshot.history
    if (!history) return
    this.patchHistory({ selectedId: topicId, loadingTopic: true, error: undefined })
    await this.loadTopic(history.sessionId, topicId)
  }

  async deleteTopic(topicId: string): Promise<void> {
    const history = this.snapshot.history
    if (!history) return
    for (const bubble of this.snapshot.bubbles.filter(item => item.topicId === topicId)) {
      this.releaseWatcher(bubble.id)
    }
    try {
      await this.options.bridge.call(history.sessionId, DELETE_COMMAND, { topicId })
    } catch (error) {
      this.patchHistory({ error: cleanHostError(error, this.options.t('error.delete')) })
      return
    }
    const topics = history.topics.filter(topic => topic.id !== topicId)
    const nextId = topics[0]?.id
    this.publish({
      ...this.snapshot,
      bubbles: this.snapshot.bubbles.filter(bubble => bubble.topicId !== topicId),
      history: {
        ...history,
        topics,
        selectedId: nextId,
        topic: undefined,
        loadingTopic: nextId !== undefined,
        error: undefined,
      },
    })
    if (nextId) await this.loadTopic(history.sessionId, nextId)
  }

  followUp(sessionId: string, topicId: string, question: string): string {
    return this.ask(sessionId, question, { topicId })
  }

  /** Retry one historical turn as a fresh turn in the same topic. */
  retryTurn(sessionId: string, topicId: string, question: string): void {
    try {
      this.ask(sessionId, question, { topicId })
    } catch (error) {
      this.patchHistory({ error: cleanHostError(error, this.t('error.follow')) })
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
    for (const controller of this.historyControllers) controller.abort()
    this.historyControllers.clear()
    for (const bubbleId of [...this.watchers.keys()]) this.releaseWatcher(bubbleId)
    this.snapshot = { bubbles: [], history: null }
    this.listeners.clear()
  }

  private async runAsk(bubble: Bubble, reference: string | undefined, controller: AbortController): Promise<void> {
    try {
      const raw = await this.options.bridge.call(bubble.sessionId, ASK_COMMAND, {
        turnId: bubble.id,
        ...(bubble.topicId === null ? {} : { topicId: bubble.topicId }),
        question: bubble.question,
        ...(reference === undefined ? {} : { reference }),
        locale: this.options.locale?.() ?? 'en',
      }, controller.signal)
      const accepted = raw as AskAccepted
      if (!accepted || typeof accepted !== 'object' || !accepted.turn || !accepted.topic) {
        throw new Error(this.options.t('error.backend'))
      }
      // The user may have closed or stopped the bubble while the Host was
      // accepting it. Do not resurrect it as running.
      if (this.cancelled.has(bubble.id) || !this.findBubble(bubble.id)) {
        void this.options.bridge.call(bubble.sessionId, CANCEL_COMMAND, {
          topicId: accepted.topic.id,
          turnId: bubble.id,
        }).catch(error => this.log('marginalia: cancel-after-dismiss failed.', error))
        return
      }
      this.pending.delete(bubble.id)
      this.update(bubble.id, {
        topicId: accepted.topic.id,
        childId: accepted.turn.childSessionId ?? bubble.id,
        status: accepted.turn.status,
        answer: accepted.turn.answer,
        ...(accepted.turn.error === undefined ? { error: undefined } : { error: accepted.turn.error }),
        streaming: accepted.turn.status === 'running',
      })
      this.mergeTopic(accepted.topic)
      this.watch(bubble.id, accepted.topic.id, accepted.turn.childSessionId ?? bubble.id)
    } catch (error) {
      this.pending.delete(bubble.id)
      if (controller.signal.aborted || this.cancelled.has(bubble.id)) return
      if (!this.findBubble(bubble.id)) return
      this.update(bubble.id, {
        status: 'error',
        error: cleanHostError(error, this.options.t('error.generic')),
        streaming: false,
      })
    }
  }

  private watch(bubbleId: string, topicId: string, childId: string): void {
    const watcher: Watcher = { bubbleId, released: false, finalizing: false, finalizeAttempts: 0 }
    this.watchers.set(bubbleId, watcher)
    const sessions = this.options.sessions
    if (!sessions) {
      void this.recoverWithoutChild(bubbleId, topicId)
      return
    }
    void (async () => {
      let reference: SessionReferenceLike | undefined
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          reference = sessions.retain(childId, { source: this.source })
          await reference.ready
          break
        } catch (error) {
          reference?.release()
          reference = undefined
          if (watcher.released) return
          if (attempt === 0) await delay(350)
        }
      }
      if (!reference) {
        void this.recoverWithoutChild(bubbleId, topicId)
        return
      }
      if (watcher.released || !this.findBubble(bubbleId)) {
        reference.release()
        return
      }
      watcher.ref = reference
      const session = reference.binding.session
      watcher.offSession = session.subscribe(() => this.check(bubbleId, watcher, topicId, childId))
      try {
        const target = this.options.conversation?.binding(reference.binding as never).target('chat')
        if (target) {
          watcher.offChat = target.subscribe(() => this.check(bubbleId, watcher, topicId, childId))
        }
      } catch (error) {
        this.log('marginalia: chat target unavailable; falling back to status polling.', error)
      }
      this.check(bubbleId, watcher, topicId, childId)
    })()
  }

  private check(bubbleId: string, watcher: Watcher, topicId: string, childId: string): void {
    if (watcher.released) return
    const bubble = this.findBubble(bubbleId)
    const reference = watcher.ref
    if (!bubble || !reference) return
    let sessionState: SessionSnapshotLike
    try {
      sessionState = reference.binding.session.getSnapshot()
    } catch {
      return
    }
    const chat = this.readChat(reference)
    if (chat.text && chat.text !== bubble.answer) {
      this.update(bubbleId, {
        answer: chat.text,
        streaming: sessionState.running === true,
      })
    }
    const settled = sessionState.openState === 'open' || sessionState.openState === 'error'
      || chat.text.length > 0
    if (sessionState.running === false && settled && !watcher.finalizing) {
      void this.finalize(bubbleId, watcher, topicId, childId, chat)
    }
  }

  private async finalize(
    bubbleId: string,
    watcher: Watcher,
    topicId: string,
    childId: string,
    chat: { text: string; error?: string },
  ): Promise<void> {
    if (watcher.finalizing || watcher.released) return
    watcher.finalizing = true
    watcher.finalizeAttempts += 1
    let retry = false
    const bubble = this.findBubble(bubbleId)
    if (!bubble) { this.releaseWatcher(bubbleId); return }
    try {
      const raw = await this.options.bridge.call(bubble.sessionId, GET_COMMAND, { topicId }) as GetResult
      const turn = raw?.topic?.turns.find(item => item.id === bubbleId)
      if (turn && turn.status === 'running' && watcher.finalizeAttempts < 4) {
        retry = true
        watcher.finalizing = false
        watcher.retryTimer = setTimeout(() => {
          void this.finalize(bubbleId, watcher, topicId, childId, chat)
        }, 600)
        watcher.retryTimer.unref?.()
        return
      }
      if (raw?.topic) this.mergeTopic(raw.topic)
      const answer = turn?.answer || chat.text
      const status: BubbleStatus = turn?.status ?? (answer ? 'complete' : 'error')
      this.update(bubbleId, {
        status,
        answer,
        ...(turn?.error === undefined ? (chat.error === undefined ? { error: undefined } : { error: chat.error }) : { error: turn.error }),
        streaming: false,
      })
    } catch (error) {
      const answer = chat.text
      this.update(bubbleId, {
        status: answer ? 'complete' : 'error',
        answer,
        error: answer ? undefined : cleanHostError(error, this.options.t('error.notAttached')),
        streaming: false,
      })
    } finally {
      if (!retry && !watcher.released) {
        watcher.finalizing = false
        this.releaseWatcher(bubbleId)
      }
    }
  }

  /**
   * Retaining the child can fail when the Client has not seen its catalog row
   * yet. The Host still owns the result, so read it back a few times before
   * declaring the bubble detached.
   */
  private async recoverWithoutChild(bubbleId: string, topicId: string): Promise<void> {
    const bubble = this.findBubble(bubbleId)
    if (!bubble) return
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const raw = await this.options.bridge.call(bubble.sessionId, GET_COMMAND, { topicId }) as GetResult
        const turn = raw?.topic?.turns.find(item => item.id === bubbleId)
        if (raw?.topic) this.mergeTopic(raw.topic)
        if (turn && turn.status !== 'running') {
          this.update(bubbleId, {
            status: turn.status,
            answer: turn.answer,
            ...(turn.error === undefined ? { error: undefined } : { error: turn.error }),
            streaming: false,
          })
          this.releaseWatcher(bubbleId)
          return
        }
      } catch {
        // Keep trying until the bounded budget is spent.
      }
      if (attempt < 4) await delay(700)
    }
    const current = this.findBubble(bubbleId)
    if (!current) return
    this.update(bubbleId, {
      status: current.answer ? 'complete' : 'error',
      error: current.answer ? undefined : this.options.t('error.notAttached'),
      streaming: false,
    })
    this.releaseWatcher(bubbleId)
  }

  private readChat(reference: SessionReferenceLike): { text: string; error?: string } {
    const conversation = this.options.conversation
    if (!conversation) return { text: '' }
    let snapshot: ChatSnapshotLike | undefined
    try {
      snapshot = conversation.binding(reference.binding as never).target('chat').getSnapshot()
    } catch {
      return { text: '' }
    }
    if (!snapshot) return { text: '' }
    const nodes = snapshot.legacy?.nodes ?? snapshot.nodes?.values?.() ?? []
    const parts: string[] = []
    let error: string | undefined
    for (const node of nodes) {
      if (node.kind === 'assistant') {
        const text = textOf(node.blocks)
        if (text) parts.push(text)
      } else if (node.kind === 'turn-error') {
        error = node.message ?? node.error
      }
    }
    const partialText = textOf(snapshot.legacy?.partial?.blocks)
    let text = parts.join('\n\n')
    if (partialText && !text.endsWith(partialText)) {
      text = text ? `${text}\n\n${partialText}` : partialText
    }
    return { text, ...(error === undefined ? {} : { error }) }
  }

  private releaseWatcher(bubbleId: string): void {
    const watcher = this.watchers.get(bubbleId)
    if (!watcher || watcher.released) return
    watcher.released = true
    if (watcher.retryTimer) clearTimeout(watcher.retryTimer)
    watcher.offSession?.()
    watcher.offChat?.()
    try { watcher.ref?.release() }
    catch (error) { this.log('marginalia: session reference release failed.', error) }
    this.watchers.delete(bubbleId)
  }

  private async loadTopics(sessionId: string, initial: boolean): Promise<void> {
    const controller = new AbortController()
    this.historyControllers.add(controller)
    try {
      const raw = await this.options.bridge.call(sessionId, LIST_COMMAND, {}, controller.signal) as ListResult
      const topics = Array.isArray(raw?.topics) ? raw.topics : []
      const history = this.snapshot.history
      if (!history || history.sessionId !== sessionId) return
      const keep = topics.some(topic => topic.id === history.selectedId)
      const selectedId = keep ? history.selectedId : topics[0]?.id
      this.publish({
        ...this.snapshot,
        history: {
          ...history,
          topics,
          selectedId,
          loading: false,
          loadingTopic: selectedId !== undefined,
          error: undefined,
          topic: keep ? history.topic : undefined,
        },
      })
      if (selectedId !== undefined) await this.loadTopic(sessionId, selectedId)
    } catch (error) {
      if (controller.signal.aborted) return
      const history = this.snapshot.history
      if (!history || history.sessionId !== sessionId) return
      this.publish({
        ...this.snapshot,
        history: { ...history, loading: false, loadingTopic: false, error: cleanHostError(error, this.options.t('error.history')) },
      })
      if (initial) this.log('marginalia: history load failed.', error)
    } finally {
      this.historyControllers.delete(controller)
    }
  }

  private async loadTopic(sessionId: string, topicId: string): Promise<void> {
    const controller = new AbortController()
    this.historyControllers.add(controller)
    try {
      const raw = await this.options.bridge.call(sessionId, GET_COMMAND, { topicId }, controller.signal) as GetResult
      const history = this.snapshot.history
      if (!history || history.sessionId !== sessionId || history.selectedId !== topicId) return
      this.publish({
        ...this.snapshot,
        history: { ...history, topic: raw?.topic, loadingTopic: false, error: undefined },
      })
    } catch (error) {
      if (controller.signal.aborted) return
      const history = this.snapshot.history
      if (!history || history.sessionId !== sessionId) return
      this.publish({
        ...this.snapshot,
        history: { ...history, loadingTopic: false, error: cleanHostError(error, this.options.t('error.history')) },
      })
    } finally {
      this.historyControllers.delete(controller)
    }
  }

  private mergeTopic(topic: BtwTopic): void {
    const history = this.snapshot.history
    if (!history || !history.open || history.sessionId !== topic.parentSessionId) return
    const summary = summarizeTopic(topic)
    const topics = [summary, ...history.topics.filter(item => item.id !== topic.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt)
    this.publish({
      ...this.snapshot,
      history: {
        ...history,
        topics,
        ...(history.selectedId === topic.id ? { topic } : {}),
      },
    })
  }

  private makeRoom(bubbles: Bubble[], sessionId: string): Bubble[] {
    const forSession = bubbles.filter(bubble => bubble.sessionId === sessionId)
    if (forSession.length <= this.maxBubbles) return bubbles
    const removable = forSession
      .filter(bubble => bubble.status !== 'starting' && bubble.status !== 'running')
      .sort((left, right) => left.updatedAt - right.updatedAt)
    const drop = new Set(removable.slice(0, forSession.length - this.maxBubbles).map(bubble => bubble.id))
    return bubbles.filter(bubble => !drop.has(bubble.id))
  }

  private findBubble(bubbleId: string): Bubble | undefined {
    return this.snapshot.bubbles.find(bubble => bubble.id === bubbleId)
  }

  private update(bubbleId: string, patch: Partial<Bubble>): void {
    let changed = false
    const bubbles = this.snapshot.bubbles.map(bubble => {
      if (bubble.id !== bubbleId) return bubble
      changed = true
      return { ...bubble, ...patch, updatedAt: this.now() }
    })
    if (changed) this.publish({ ...this.snapshot, bubbles })
  }

  private patchHistory(patch: Partial<HistoryState>): void {
    const history = this.snapshot.history
    if (!history) return
    this.publish({ ...this.snapshot, history: { ...history, ...patch } })
  }

  private publish(snapshot: MarginaliaSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

function textOf(blocks: readonly AssistantBlockLike[] | undefined): string {
  if (!blocks) return ''
  return blocks
    .filter(block => block.kind === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('')
    .trim()
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

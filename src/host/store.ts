/**
 * Durable side-question storage.
 *
 * The workspace profile always composes `storage` + `storage-domain`, so the
 * normal path opens a schema-validated domain. When that form is absent (a
 * minimal headless composition), the store degrades to process memory and says
 * so in the log; it never silently writes a global JSON file.
 */
import { z } from 'zod'
import type { DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import type { BtwStatus, BtwTopic, BtwTopicSummary } from '../shared'
import { summarizeTopic } from '../shared'

const statusSchema = z.enum(['running', 'complete', 'cancelled', 'error', 'interrupted'])

const turnSchema = z.object({
  id: z.string().min(1),
  question: z.string(),
  answer: z.string(),
  status: statusSchema,
  error: z.string().optional(),
  reference: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  childSessionId: z.string().optional(),
})

const topicSchema = z.object({
  id: z.string().min(1),
  parentSessionId: z.string().min(1),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  turns: z.array(turnSchema),
})

export const marginaliaDomainSpec = {
  name: 'marginalia',
  version: 1,
  tables: {
    topics: { valueSchema: topicSchema },
  },
} as unknown as DomainSpec

interface TableLike {
  get(key: string): BtwTopic | undefined
  entries(): IterableIterator<[string, BtwTopic]>
  keys(): IterableIterator<string>
  readonly size: number
  put(key: string, value: BtwTopic): Promise<void>
  delete(key: string): Promise<boolean>
}

interface DomainLike {
  table(name: 'topics'): TableLike
  close(): Promise<void>
}

class MemoryTable implements TableLike {
  private readonly map = new Map<string, BtwTopic>()
  get(key: string): BtwTopic | undefined { return this.map.get(key) }
  entries(): IterableIterator<[string, BtwTopic]> { return this.map.entries() }
  keys(): IterableIterator<string> { return this.map.keys() }
  get size(): number { return this.map.size }
  async put(key: string, value: BtwTopic): Promise<void> { this.map.set(key, value) }
  async delete(key: string): Promise<boolean> { return this.map.delete(key) }
}

export function topicKey(parentSessionId: string, topicId: string): string {
  return `${parentSessionId}:${topicId}`
}

interface StoreOptions {
  readonly now?: () => number
  readonly onWarning?: (message: string, error?: unknown) => void
}

/** One durable topic per side-question thread, keyed by parent session + topic. */
export class BtwStore {
  private readonly chains = new Map<string, Promise<unknown>>()
  private closed = false
  private readonly now: () => number
  private readonly onWarning: (message: string, error?: unknown) => void

  private constructor(
    private readonly domain: DomainLike,
    readonly mode: 'storage' | 'memory',
    options: StoreOptions,
  ) {
    this.now = options.now ?? Date.now
    this.onWarning = options.onWarning ?? (() => {})
  }

  static async open(
    ctx: { get(name: string): unknown; logger?: { warn(message: string, ...rest: unknown[]): void } },
    options: StoreOptions = {},
  ): Promise<BtwStore> {
    const warn = (message: string, error?: unknown) => {
      ctx.logger?.warn(message, error)
      options.onWarning?.(message, error)
    }
    const facility = ctx.get('storageDomain') as { open(spec: unknown): Promise<DomainLike> } | undefined
    if (!facility) {
      warn('dsh-marginalia: storageDomain is unavailable; side-question history is process-memory only.')
      return BtwStore.memory(options, warn)
    }
    let domain: DomainLike
    try {
      domain = await facility.open(marginaliaDomainSpec)
    } catch (error) {
      warn('dsh-marginalia: could not open the side-question domain; falling back to process memory.', error)
      return BtwStore.memory(options, warn)
    }
    const store = new BtwStore(domain, 'storage', { ...options, onWarning: warn })
    try {
      const repaired = await store.markInterrupted()
      if (repaired > 0) ctx.logger?.warn(`dsh-marginalia: marked ${repaired} interrupted side-question topic(s) after restart.`)
    } catch (error) {
      warn('dsh-marginalia: could not repair interrupted side-question topics.', error)
    }
    return store
  }

  private static memory(options: StoreOptions, warn: (message: string, error?: unknown) => void): BtwStore {
    const table = new MemoryTable()
    return new BtwStore({ table: () => table, close: async () => {} }, 'memory', { ...options, onWarning: warn })
  }

  get size(): number { return this.table.size }

  get(parentSessionId: string, topicId: string): BtwTopic | undefined {
    return this.table.get(topicKey(parentSessionId, topicId))
  }

  list(parentSessionId: string, limit = 50): BtwTopicSummary[] {
    const rows: BtwTopicSummary[] = []
    for (const [key, topic] of this.table.entries()) {
      if (!key.startsWith(`${parentSessionId}:`)) continue
      if (topic.parentSessionId !== parentSessionId) continue
      rows.push(summarizeTopic(topic))
    }
    rows.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
    return rows.slice(0, Math.max(1, limit))
  }

  async put(topic: BtwTopic): Promise<void> {
    this.assertOpen()
    await this.enqueue(topicKey(topic.parentSessionId, topic.id), () => this.table.put(topicKey(topic.parentSessionId, topic.id), topic))
  }

  async delete(parentSessionId: string, topicId: string): Promise<boolean> {
    this.assertOpen()
    return this.enqueue(topicKey(parentSessionId, topicId), () => this.table.delete(topicKey(parentSessionId, topicId)))
  }

  /**
   * A process restart cannot resume a detached fork whose parent turn has moved
   * on. `running` is therefore a crash artifact, not work to retry; mark it
   * interrupted and never auto-send.
   */
  async markInterrupted(): Promise<number> {
    const at = this.now()
    let repaired = 0
    for (const [key, topic] of [...this.table.entries()]) {
      if (!topic.turns.some(turn => turn.status === 'running')) continue
      const turns = topic.turns.map(turn => turn.status === 'running'
        ? { ...turn, status: 'interrupted' as BtwStatus, updatedAt: at }
        : turn)
      const next: BtwTopic = { ...topic, turns, updatedAt: at }
      await this.enqueue(key, () => this.table.put(key, next))
      repaired += 1
    }
    return repaired
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.allSettled([...this.chains.values()])
    await this.domain.close()
  }

  private get table(): TableLike {
    return this.domain.table('topics')
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The side-question store is closed.')
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    // Keep a settled, failure-swallowed tail so the next write still queues
    // after this one; the caller receives the original promise.
    this.chains.set(key, next.then(() => undefined, () => undefined))
    return next
  }
}

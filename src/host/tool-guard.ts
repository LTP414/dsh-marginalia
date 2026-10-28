/**
 * Execution-time read-only guard.
 *
 * The child fork inherits the parent's tool catalog so the provider-side
 * request prefix stays identical. A prompt alone cannot make that safe: the
 * model can still emit a tool call. This guard is monotonic and denies every
 * tool for the exact child ids this plugin reserved. It never filters the
 * catalog and never changes the system prompt.
 */
export const BTW_TOOL_DENIED =
  'Marginalia side questions are read-only: tool execution is disabled for this turn. Answer in text only.'

interface GuardAgent {
  readonly id?: string
  readonly ctx?: {
    readonly tools?: {
      guard(guard: (execution: { readonly agent?: { readonly id?: string } }) => string | undefined): () => void | Promise<void>
    }
  }
}

type Disposer = () => void | Promise<void>

export class ChildGuard {
  private readonly owned = new Set<string>()
  private readonly childGuards = new Map<string, Disposer>()

  readonly check = (execution: { readonly agent?: { readonly id?: string } }): string | undefined => {
    const id = execution.agent?.id
    return id !== undefined && this.owned.has(id) ? BTW_TOOL_DENIED : undefined
  }

  has(id: string): boolean {
    return this.owned.has(id)
  }

  /** Reserve the child id before the activation exists. */
  own(id: string): Disposer {
    this.owned.add(id)
    return () => { this.owned.delete(id) }
  }

  /** Defence in depth: the child's own scope also carries the same guard. */
  attach(agent: GuardAgent): void {
    const id = agent.id
    if (!id || !this.owned.has(id) || this.childGuards.has(id)) return
    try {
      const release = agent.ctx?.tools?.guard(this.check)
      if (release) this.childGuards.set(id, release)
    } catch {
      // The root guard is the primary barrier; a scope that is not ready yet
      // must not fail child creation.
    }
  }

  async release(id: string): Promise<void> {
    this.owned.delete(id)
    const release = this.childGuards.get(id)
    this.childGuards.delete(id)
    if (release) await release()
  }

  async releaseAll(): Promise<void> {
    this.owned.clear()
    const releases = [...this.childGuards.values()]
    this.childGuards.clear()
    await Promise.allSettled(releases.map(release => Promise.resolve().then(release)))
  }
}

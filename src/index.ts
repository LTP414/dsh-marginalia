/**
 * dsh-marginalia — read-only side questions for DeepSeek Harness.
 *
 * Host half: reserve a child id, fork the current session, deny every tool at
 * execution time, persist one turn, and expose hidden authenticated commands
 * for the Web Client. The public `/btw` command is claimed by the Client input
 * source so it can render a bubble instead of a command result.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import { BtwStore } from './host/store'
import { ChildGuard } from './host/tool-guard'
import { StreamCapture } from './host/parent-context'
import { BtwEngine, type ChildHandle, type ChildResult, type ParentAgent, type StartChildRequest } from './host/engine'
import { hideInternalCommands, registerBtwCommands } from './host/commands'
import { PLUGIN_NAME } from './shared'

export const name = PLUGIN_NAME
export const inject = ['commands', 'subagents', 'tools']

interface SubagentActivationLike {
  readonly result: Promise<ChildResult>
  dispose(): Promise<void>
}

export async function apply(ctx: Context): Promise<void> {
  const log = (message: string, error?: unknown) => {
    if (error === undefined) ctx.logger.warn(message)
    else ctx.logger.warn(message, error)
  }

  const store = await BtwStore.open(ctx, { onWarning: log })
  const guard = new ChildGuard()
  const capture = new StreamCapture()

  const releaseGuard = ctx.tools.guard(guard.check)
  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    guard.attach(agent as unknown as Parameters<ChildGuard['attach']>[0])
    return undefined
  })
  const stopStream = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    capture.observe(agent.id, frame as Parameters<StreamCapture['observe']>[1])
  })

  const startChild = async (request: StartChildRequest): Promise<ChildHandle> => {
    const provider = ctx.subagents.getProvider('fork')
    if (!provider?.inheritsParentContext) {
      throw new Error('The fork provider does not inherit the parent context; a read-only side question cannot start.')
    }
    const activation = await ctx.subagents.startActivation({
      provider: 'fork',
      label: request.label,
      childId: request.childId as SessionId,
      request: {
        parent: request.parent as unknown as Agent,
        prompt: [{ type: 'text', text: request.prompt }],
        agentOptions: { maxTokens: request.maxTokens },
      },
      signal: request.signal,
      delivery: 'caller',
    }) as unknown as SubagentActivationLike
    return {
      result: activation.result,
      dispose: () => activation.dispose(),
    }
  }

  const archiveChild = async (childId: string): Promise<void> => {
    const registry = ctx.get('workspaceRegistry') as
      | { archiveSession(sessionId: SessionId, options?: { stopActivity?: boolean }): Promise<void> }
      | undefined
    if (!registry) return
    await registry.archiveSession(childId as SessionId)
  }

  const engine = new BtwEngine({
    store,
    startChild,
    guard,
    capture,
    archiveChild,
    log,
  })

  const hide = hideInternalCommands(ctx.commands as unknown as { list: (agent: unknown) => readonly { name: string }[] })
  const commandDisposers = registerBtwCommands(ctx, engine)

  let disposed = false
  ctx.effect(() => () => {
    if (disposed) return
    disposed = true
    for (const dispose of commandDisposers) {
      try { dispose() } catch (error) { log('dsh-marginalia: command disposer failed.', error) }
    }
    hide()
    stopCreated()
    stopStream()
    return (async () => {
      try { await engine.dispose() }
      catch (error) { log('dsh-marginalia: engine cleanup failed.', error) }
      try { await releaseGuard() }
      catch (error) { log('dsh-marginalia: guard cleanup failed.', error) }
      try { await store.close() }
      catch (error) { log('dsh-marginalia: store cleanup failed.', error) }
    })()
  })

  if (store.mode === 'memory') {
    log('dsh-marginalia: running with in-memory history (storage domain unavailable).')
  }
  ctx.logger.info?.(`dsh-marginalia: ready (${store.mode} history).`)
}

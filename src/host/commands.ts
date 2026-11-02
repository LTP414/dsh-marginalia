/**
 * Hidden command transport.
 *
 * The Client half reaches the Host through the existing authenticated
 * `commands.execute` RPC. This avoids opening an unauthenticated HTTP route for
 * history or answers. The trade-off — command lifecycle records include the
 * result text — is documented in the README; the public endpoints stay hidden
 * from the slash menu.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import {
  ASK_COMMAND,
  CANCEL_COMMAND,
  DELETE_COMMAND,
  GET_COMMAND,
  LIST_COMMAND,
  INTERNAL_COMMANDS,
  BtwRequestError,
  parseAskRequest,
  parseCancelRequest,
  parseDeleteRequest,
  parseGetRequest,
  parseListRequest,
} from '../shared'
import type { BtwEngine, ParentAgent } from './engine'

function errorText(error: unknown): string {
  if (error instanceof BtwRequestError) return error.message
  return error instanceof Error ? error.message : String(error)
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

export function registerBtwCommands(ctx: Context, engine: BtwEngine): Array<() => void> {
  const ask: CommandDefinition = {
    name: ASK_COMMAND,
    description: 'Marginalia internal: start a read-only side question.',
    recordInput: false,
    handler: async invocation => {
      try {
        const request = parseAskRequest(invocation.rawInput)
        const accepted = await engine.ask({ ...request, parent: invocation.agent as unknown as ParentAgent })
        return { kind: 'success', text: json(accepted) }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  }

  const list: CommandDefinition = {
    name: LIST_COMMAND,
    description: 'Marginalia internal: list side-question topics.',
    recordInput: false,
    handler: invocation => {
      try {
        const request = parseListRequest(invocation.rawInput)
        return {
          kind: 'success',
          text: json({ topics: engine.list(invocation.agent.session.header.id, request.limit) }),
        }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  }

  const get: CommandDefinition = {
    name: GET_COMMAND,
    description: 'Marginalia internal: read one side-question topic.',
    recordInput: false,
    handler: invocation => {
      try {
        const request = parseGetRequest(invocation.rawInput)
        return {
          kind: 'success',
          text: json({ topic: engine.get(invocation.agent.session.header.id, request.topicId) }),
        }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  }

  const cancel: CommandDefinition = {
    name: CANCEL_COMMAND,
    description: 'Marginalia internal: cancel a running side question.',
    recordInput: false,
    handler: async invocation => {
      try {
        const request = parseCancelRequest(invocation.rawInput)
        await engine.cancel(invocation.agent.session.header.id, request.topicId, request.turnId)
        return { kind: 'success', text: json({ cancelled: true }) }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  }

  const remove: CommandDefinition = {
    name: DELETE_COMMAND,
    description: 'Marginalia internal: delete one side-question topic.',
    recordInput: false,
    handler: async invocation => {
      try {
        const request = parseDeleteRequest(invocation.rawInput)
        await engine.delete(invocation.agent.session.header.id, request.topicId)
        return { kind: 'success', text: json({ deleted: true }) }
      } catch (error) {
        return { kind: 'error', text: errorText(error) }
      }
    },
  }

  const disposers = [ask, list, get, cancel, remove].map(definition => ctx.commands.register(definition))
  return disposers
}

/**
 * Keep the transport commands out of the slash-command directory while leaving
 * `find`/`execute` intact for the authenticated RPC. The wrapper is removed on
 * plugin unload, and a later wrapper installed by another plugin is preserved.
 */
interface LifecycleSink {
  appendLifecycle?(session: unknown, type: string, data: { name?: string; commandId?: string }): void
}

/**
 * Keep the internal transport out of the session log as well as the slash
 * directory. `commands.execute` logs a run/done pair around every handler; for
 * Marginalia those pairs would add Chat nodes and copy the whole topic JSON of
 * `btw-get` into `command/done`. Suppressing that pair keeps the authenticated
 * RPC path (no new HTTP surface) without polluting the main transcript.
 *
 * This is an instance-level compatibility shim, like the directory filter. If a
 * future DSH removes `appendLifecycle`, the plugin still works and logs the
 * commands; the warning is emitted by the caller.
 */
export function quietInternalCommands(
  commands: LifecycleSink,
  onUnsupported?: () => void,
): () => void {
  const original = commands.appendLifecycle
  if (typeof original !== 'function') {
    onUnsupported?.()
    return () => {}
  }
  const own = Object.getOwnPropertyDescriptor(commands, 'appendLifecycle')
  const tracked = new Set<string>()
  const quieted = function (this: unknown, session: unknown, type: string, data: { name?: string; commandId?: string }) {
    if (type === 'command/run' && typeof data?.name === 'string' && (INTERNAL_COMMANDS as readonly string[]).includes(data.name)) {
      if (typeof data.commandId === 'string') tracked.add(data.commandId)
      if (tracked.size > 256) tracked.clear()
      return
    }
    if (type === 'command/done' && typeof data?.commandId === 'string' && tracked.delete(data.commandId)) return
    return original.call(this, session, type, data)
  } as NonNullable<LifecycleSink['appendLifecycle']>
  Object.defineProperty(commands, 'appendLifecycle', { configurable: true, writable: true, value: quieted })
  return () => {
    if (Object.getOwnPropertyDescriptor(commands, 'appendLifecycle')?.value !== quieted) return
    if (own) Object.defineProperty(commands, 'appendLifecycle', own)
    else Reflect.deleteProperty(commands, 'appendLifecycle')
  }
}

export function hideInternalCommands(commands: { list: (agent: unknown) => readonly { name: string }[] }): () => void {
  const own = Object.getOwnPropertyDescriptor(commands, 'list')
  const original = commands.list
  let active = true
  const filtered = function (this: unknown, agent: unknown) {
    const rows = original.call(this, agent)
    return active ? Object.freeze(rows.filter(row => !(INTERNAL_COMMANDS as readonly string[]).includes(row.name))) : rows
  } as typeof original
  Object.defineProperty(commands, 'list', { configurable: true, writable: true, value: filtered })
  return () => {
    active = false
    if (Object.getOwnPropertyDescriptor(commands, 'list')?.value !== filtered) return
    if (own) Object.defineProperty(commands, 'list', own)
    else Reflect.deleteProperty(commands, 'list')
  }
}

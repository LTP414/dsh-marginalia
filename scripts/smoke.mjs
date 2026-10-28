#!/usr/bin/env node
/**
 * Built-artifact smoke test. It loads the two bundles exactly the way the two
 * runtimes do: an ESM import for the Host and the Harness module loader for the
 * browser half. This catches packaging and top-level-runtime mistakes that unit
 * tests on src/ cannot catch.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const host = await import('../lib/index.js')
assert.equal(host.name, 'dsh-marginalia', 'host bundle name')
assert.equal(typeof host.apply, 'function', 'host apply export')
for (const service of ['commands', 'subagents', 'tools']) {
  assert.ok(host.inject.includes(service), `host injects ${service}`)
}

globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', innerHTML: '', remove: () => {} }),
  head: { append: () => {} },
  documentElement: { append: () => {} },
}
let client
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      assert.equal(id, 'dsh-marginalia', 'client module id')
      client = factory(require)
    },
  },
}
await import('../lib/client.js')
assert.ok(client, 'client bundle registered with the loader')
assert.equal(client.name, 'dsh-marginalia', 'client bundle name')
assert.equal(typeof client.apply, 'function', 'client apply export')
for (const service of ['slots', 'remote', 'remote.commands', 'locale', 'sessions', 'uiConversation', 'inputTriggers']) {
  assert.ok(client.inject.includes(service), `client injects ${service}`)
}

console.log('smoke: host bundle + client bundle loaded and exported correctly')

// Exercise the built Client half through its real apply() and its real /btw
// claim while simulating a plain-HTTP origin (no crypto.randomUUID).
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: {
    getRandomValues: (target) => {
      for (let index = 0; index < target.length; index += 1) target[index] = 0x3c
      return target
    },
  },
})

const sources = []
const slots = []
const effects = []
const calls = []
const session = {
  getSnapshot: () => ({ running: true, openState: 'open', subagent: null }),
  subscribe: () => () => {},
}
const ctx = {
  logger: { warn: () => {} },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
    getLocale: () => ({ active: 'en-US' }),
  },
  effect: (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') effects.push(dispose)
    return () => {}
  },
  slots: {
    inject: (_key, callback) => callback(),
    register: (options) => {
      slots.push(options)
      return () => {}
    },
  },
  inputTriggers: {
    registerSource: (source) => {
      sources.push(source)
      return () => {}
    },
  },
  sessions: {
    retain: () => ({
      sessionId: 'child',
      ready: Promise.resolve(),
      binding: { session },
      release: () => {},
    }),
    binding: () => ({ session }),
  },
  uiConversation: {
    binding: () => ({
      target: () => ({
        getSnapshot: () => ({ legacy: { partial: null, nodes: [] } }),
        subscribe: () => () => {},
      }),
    }),
  },
  remote: {
    commands: {
      execute: async (_sessionId, line) => {
        const name = line.slice(1).split(' ')[0]
        calls.push(name)
        if (name !== 'btw-ask') return { ok: true, value: { result: { kind: 'success', text: '{}' } } }
        return {
          ok: true,
          value: {
            result: {
              kind: 'success',
              text: JSON.stringify({
                topic: { id: '22222222-2222-4222-8222-222222222222', parentSessionId: 'parent-1', title: 'Q', createdAt: 1, updatedAt: 1, turns: [] },
                turn: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', question: 'Q', answer: '', status: 'running', createdAt: 1, updatedAt: 1 },
              }),
            },
          },
        }
      },
    },
  },
}

client.apply(ctx)
assert.deepEqual(slots.map(options => options.id).filter(Boolean).sort(), [
  'dsh-marginalia-bubbles',
  'dsh-marginalia-history',
  'dsh-marginalia-history-button',
])
assert.equal(sources.length, 1, 'one /btw source')
const outcome = await sources[0].matchEnter({ sessionId: 'parent-1' }, '/btw Why?', new AbortController().signal, { attachments: 0 })
assert.ok(outcome && typeof outcome === 'object' && 'claim' in outcome, 'enter claims /btw')
const submitted = await outcome.claim.submit('Why?', {}, [])
assert.deepEqual(submitted, { kind: 'success' })
await new Promise(resolve => setTimeout(resolve, 0))
assert.ok(calls.includes('btw-ask'), 'built client reached btw-ask')
assert.equal(globalThis.crypto.randomUUID, undefined, 'simulated insecure origin')
for (const dispose of [...effects].reverse()) await dispose()
if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto)
console.log('smoke: built client applied and claimed /btw without crypto.randomUUID')

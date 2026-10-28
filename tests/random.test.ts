import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomId } from '../src/random'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('randomId', () => {
  it('uses crypto.randomUUID when available', () => {
    expect(randomId()).toMatch(UUID_V4)
  })

  it('uses getRandomValues on a plain-HTTP browser without randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (target: Uint8Array) => {
        for (let index = 0; index < target.length; index += 1) target[index] = 0xab
        return target
      },
    })
    const id = randomId()
    expect(id).toMatch(UUID_V4)
    expect(id.endsWith('abababababab')).toBe(true)
  })

  it('falls back when randomUUID throws', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => { throw new Error('insecure context') },
      getRandomValues: (target: Uint8Array) => {
        target.fill(0x01)
        return target
      },
    })
    expect(randomId()).toMatch(UUID_V4)
  })

  it('still returns a valid v4 shape without any crypto global', () => {
    vi.stubGlobal('crypto', undefined)
    const ids = new Set(Array.from({ length: 200 }, () => randomId()))
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(ids.size).toBe(200)
  })
})

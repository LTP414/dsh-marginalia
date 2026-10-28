import { describe, expect, it, vi } from 'vitest'
import { ChildGuard, BTW_TOOL_DENIED } from '../src/host/tool-guard'

describe('ChildGuard', () => {
  it('denies every tool for an owned child and nothing else', async () => {
    const guard = new ChildGuard()
    const release = guard.own('child-a')
    expect(guard.check({ agent: { id: 'child-a' } })).toBe(BTW_TOOL_DENIED)
    expect(guard.check({ agent: { id: 'parent' } })).toBeUndefined()
    expect(guard.check({})).toBeUndefined()
    await release()
    expect(guard.check({ agent: { id: 'child-a' } })).toBeUndefined()
  })

  it('attaches one child-scope guard and releases it', async () => {
    const guard = new ChildGuard()
    guard.own('child-b')
    const release = vi.fn()
    const install = vi.fn(() => release)
    guard.attach({
      id: 'child-b',
      ctx: { tools: { guard: install } },
    })
    guard.attach({
      id: 'child-b',
      ctx: { tools: { guard: install } },
    })
    expect(install).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledWith(guard.check)
    await guard.release('child-b')
    expect(release).toHaveBeenCalledTimes(1)
    expect(guard.check({ agent: { id: 'child-b' } })).toBeUndefined()
  })

  it('does not attach to unrelated agents and contains install failures', async () => {
    const guard = new ChildGuard()
    const install = vi.fn(() => { throw new Error('scope closed') })
    expect(() => guard.attach({ id: 'other', ctx: { tools: { guard: install } } })).not.toThrow()
    expect(install).not.toHaveBeenCalled()
    guard.own('child-c')
    expect(() => guard.attach({ id: 'child-c', ctx: { tools: { guard: install } } })).not.toThrow()
    await guard.releaseAll()
    expect(guard.check({ agent: { id: 'child-c' } })).toBeUndefined()
  })
})

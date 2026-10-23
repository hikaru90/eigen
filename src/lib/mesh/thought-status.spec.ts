import { describe, expect, it } from 'vitest'
import { effectiveLifecycleStatus, isTodoCategory } from './thought-status'

/**
 * Thought status for the Yarn tick, resolved exactly the way the unified
 * timeline resolves it (src/lib/server/memory/temporal-event-list.ts:240-243,
 * resolveThoughtLifecycleStatus): the lifecycle column wins; the legacy
 * metadata.status only fills in for rows that predate it.
 */

describe('effectiveLifecycleStatus', () => {
  it('trusts the lifecycle column when it is set', () => {
    expect(effectiveLifecycleStatus('open', undefined)).toBe('open')
    expect(effectiveLifecycleStatus('completed', undefined)).toBe('completed')
    expect(effectiveLifecycleStatus('archived', undefined)).toBe('archived')
    // the column wins even when legacy metadata disagrees
    expect(effectiveLifecycleStatus('completed', 'open')).toBe('completed')
  })

  it('falls back to legacy metadata.status for rows without a lifecycle column', () => {
    expect(effectiveLifecycleStatus(null, 'completed')).toBe('completed')
    expect(effectiveLifecycleStatus(null, 'archived')).toBe('archived')
    expect(effectiveLifecycleStatus(undefined, 'open')).toBe('open')
  })

  it('treats unknown values as open — never invents a state', () => {
    expect(effectiveLifecycleStatus('nonsense', undefined)).toBe('open')
    expect(effectiveLifecycleStatus(null, 'weird')).toBe('open')
    expect(effectiveLifecycleStatus(null, undefined)).toBe('open')
  })
})

describe('isTodoCategory', () => {
  it('recognizes the to-do category the LLM assigns at capture', () => {
    // Rendering-only use of the persisted category key — the same signal the
    // unified timeline uses (temporal-event-list.ts:113 isTaskListItem).
    expect(isTodoCategory('task')).toBe(true)
  })

  it('leaves every other category alone', () => {
    expect(isTodoCategory('idea')).toBe(false)
    expect(isTodoCategory('observation')).toBe(false)
    expect(isTodoCategory('question')).toBe(false)
    expect(isTodoCategory('')).toBe(false)
  })
})

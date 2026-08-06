import { describe, expect, it } from 'vitest'
import {
  isThoughtCategoryKeyConfusion,
  normalizeMemoryType,
  THOUGHT_CATEGORY_ONLY_KEYS,
} from './memory-type-catalog'

describe('memory-type-catalog', () => {
  it('accepts canonical memoryType keys', () => {
    expect(normalizeMemoryType('fact')).toBe('fact')
    expect(normalizeMemoryType(' EPISODE ')).toBe('episode')
    expect(normalizeMemoryType('decision')).toBe('decision')
    expect(normalizeMemoryType('task')).toBe('task')
  })

  it('maps legacy open_loop to task', () => {
    expect(normalizeMemoryType('open_loop')).toBe('task')
    expect(normalizeMemoryType('OPEN-LOOP')).toBe('task')
  })

  it('rejects thought category-only keys as memoryType', () => {
    for (const key of THOUGHT_CATEGORY_ONLY_KEYS) {
      expect(normalizeMemoryType(key)).toBeNull()
      expect(isThoughtCategoryKeyConfusion(key)).toBe(true)
    }
  })

  it('does not flag decision or task as category-only confusion', () => {
    expect(normalizeMemoryType('decision')).toBe('decision')
    expect(isThoughtCategoryKeyConfusion('decision')).toBe(false)
    expect(normalizeMemoryType('task')).toBe('task')
    expect(isThoughtCategoryKeyConfusion('task')).toBe(false)
  })

  it('detects observation confusion from bundled capture failure class', () => {
    expect(isThoughtCategoryKeyConfusion('observation')).toBe(true)
    expect(normalizeMemoryType('observation')).toBeNull()
  })
})

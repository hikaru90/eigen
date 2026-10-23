import { describe, expect, it } from 'vitest'
import { canScrollInput, wheelDeltaPixels } from './scroll-overlay'

describe('scrolling above the conversation', () => {
  it('lets an overflowing textarea consume motion until its boundary', () => {
    const input = { scrollTop: 20, scrollHeight: 200, clientHeight: 80 }
    expect(canScrollInput(input, 40)).toBe(true)
    expect(canScrollInput(input, -40)).toBe(true)
    expect(canScrollInput({ ...input, scrollTop: 0 }, -40)).toBe(false)
    expect(canScrollInput({ ...input, scrollTop: 120 }, 40)).toBe(false)
    expect(canScrollInput({ scrollTop: 0, scrollHeight: 80, clientHeight: 80 }, 40)).toBe(false)
  })

  it('normalizes trackpad, line and page wheel units', () => {
    expect(wheelDeltaPixels(12, 0, 600)).toBe(12)
    expect(wheelDeltaPixels(-3, 1, 600)).toBe(-48)
    expect(wheelDeltaPixels(1, 2, 600)).toBe(600)
  })
})

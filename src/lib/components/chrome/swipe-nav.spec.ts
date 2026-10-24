import { describe, expect, it } from 'vitest'
import { SWIPE_MIN_PX, swipeNavTarget } from './swipe-nav'

const swipe = (dx: number, dy = 0) => ({ dx, dy })

describe('swipeNavTarget', () => {
  it('left swipe goes to the next core page, right swipe to the previous', () => {
    expect(swipeNavTarget('capture', swipe(-SWIPE_MIN_PX - 1))).toBe('/mesh')
    expect(swipeNavTarget('mesh', swipe(-SWIPE_MIN_PX - 1))).toBe('/chat')
    expect(swipeNavTarget('ask', swipe(SWIPE_MIN_PX + 1))).toBe('/mesh')
    expect(swipeNavTarget('mesh', swipe(SWIPE_MIN_PX + 1))).toBe('/capture')
  })

  it('stops at the ends — no wrap-around', () => {
    expect(swipeNavTarget('capture', swipe(SWIPE_MIN_PX + 1))).toBeNull()
    expect(swipeNavTarget('ask', swipe(-SWIPE_MIN_PX - 1))).toBeNull()
  })

  it('ignores short or mostly vertical gestures (scrolling)', () => {
    expect(swipeNavTarget('capture', swipe(-SWIPE_MIN_PX + 5))).toBeNull()
    expect(swipeNavTarget('capture', swipe(-120, 100))).toBeNull()
  })

  it('does nothing outside the three core pages', () => {
    expect(swipeNavTarget(null, swipe(-200))).toBeNull()
  })
})

import type { BottomNavId } from './nav-active'

/** The core loop, left to right — the bottom menu's order. */
const ORDER: ReadonlyArray<readonly [BottomNavId, '/capture' | '/mesh' | '/chat']> = [
  ['capture', '/capture'],
  ['mesh', '/mesh'],
  ['ask', '/chat'],
]

/** A swipe must travel this far sideways… */
export const SWIPE_MIN_PX = 70
/** …and be clearly horizontal (|dx| ≥ this × |dy|), so vertical scrolling never navigates. */
const HORIZONTAL_RATIO = 1.8

/**
 * Where a horizontal swipe on a core page leads: left = the next page in the bottom
 * menu, right = the previous one; nothing at the ends, on other pages, or for a
 * short / vertical gesture.
 */
export function swipeNavTarget(
  current: BottomNavId | null,
  gesture: { dx: number; dy: number },
): '/capture' | '/mesh' | '/chat' | null {
  if (!current) return null
  const { dx, dy } = gesture
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < HORIZONTAL_RATIO * Math.abs(dy)) return null
  const index = ORDER.findIndex(([id]) => id === current)
  const next = ORDER[index + (dx < 0 ? 1 : -1)]
  return next ? next[1] : null
}

/** Gestures that start in a text field or a sideways-scrolling area belong to it, not to navigation. */
export function swipeStartsInOwnGesture(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null
  while (el) {
    if (el.matches('input, textarea, select, [contenteditable="true"], [data-no-swipe-nav]')) return true
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflowX = getComputedStyle(el).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    el = el.parentElement
  }
  return false
}

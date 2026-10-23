/**
 * Guards for the Make-me-better glimpse, ported from the ei prototype
 * (`app.js` glimpse interval): every 30 s the loop of yarn turns to clay
 * yarn and turns once (2.8 s) — never while you are on the page, typing,
 * away from the tab, or asking for reduced motion.
 */

export const GLIMPSE_INTERVAL_MS = 30_000
export const GLIMPSE_HOLD_MS = 2_800

/** Anything the guard reads about the world; keeps the decision pure and testable. */
export type GlimpseGuards = {
  /** The user is already on the Make me better page. */
  onEntryPage: boolean
  /** `document.hidden` — the tab is not visible. */
  tabHidden: boolean
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean
}

/** Minimal structural view of an element (HTMLElement satisfies it). */
export type WritableElementLike = {
  tagName?: unknown
  isContentEditable?: boolean
  value?: unknown
}

/**
 * The user is writing when the focused element is a field with actual words in
 * it. Focus alone does not block the glimpse: an empty field is not writing
 * (ei: `isTyping(a) && !!(a.value || '').trim()`).
 */
export function isWritingIntoField(el: WritableElementLike | null | undefined): boolean {
  if (!el) return false
  const isField =
    el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable === true
  return isField && typeof el.value === 'string' && el.value.trim() !== ''
}

export function shouldGlimpse(
  guards: GlimpseGuards,
  activeElement?: WritableElementLike | null,
): boolean {
  if (guards.onEntryPage || guards.tabHidden || guards.reducedMotion) return false
  return !isWritingIntoField(activeElement)
}

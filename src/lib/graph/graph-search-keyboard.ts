/**
 * Decide whether a keyboard event in the graph search input should explicitly
 * submit the filter and update the graph. The graph also updates reactively
 * per keystroke; this guarantees a committed update on Enter (e.g. when the
 * reactive scheduler has not yet been wired).
 */
export function shouldSubmitSearchOnEnter(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter') return false
  if (event.isComposing) return false
  return true
}

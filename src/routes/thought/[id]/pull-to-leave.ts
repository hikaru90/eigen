/**
 * Swipe down from the top to leave the thought page (ei DESIGN.md "Pages, never
 * modals"; ei app.js:1377-1397). Ported as a Svelte action: touchstart/move/end
 * listeners with cleanup, no `$effect`. The pull follows the finger at 0.55, the card
 * fades as it goes (`--pull` drives the CSS), and the page leaves once the finger has
 * travelled 110 px. It never fights scrolling (a pull only starts at the top) and never
 * starts from a field.
 */

/** ei app.js:1388 — how much of the finger's travel the card follows. */
export const PULL_DAMPING = 0.55
/** ei app.js:1392 — finger travel that means "leave". */
export const PULL_LEAVE_PX = 110
/** ei styles.css:1146 — the card is gone after this much offset. */
export const PULL_FADE_PX = 400

export function pullOffsetPx(dy: number): number {
  return Math.round(Math.max(0, dy) * PULL_DAMPING * 10) / 10
}

export function pullLeaves(dy: number): boolean {
  return dy > PULL_LEAVE_PX
}

export function pullOpacity(offsetPx: number): number {
  return Math.min(1, Math.max(0, 1 - offsetPx / PULL_FADE_PX))
}

/** The slice of an element the action needs — narrow so the node can be stubbed in specs. */
export type PullHost = {
  addEventListener(
    type: 'touchstart' | 'touchmove' | 'touchend',
    listener: (event: TouchEvent) => void,
    options?: AddEventListenerOptions,
  ): void
  removeEventListener(
    type: 'touchstart' | 'touchmove' | 'touchend',
    listener: (event: TouchEvent) => void,
  ): void
  style: {
    setProperty(name: string, value: string): void
    removeProperty(name: string): void
  }
  classList: {
    add(name: string): void
    remove(name: string): void
  }
  scrollTop: number
  parentElement: PullScrollHost | null
}

type PullScrollHost = { scrollTop: number; parentElement: PullScrollHost | null }

export type PullToLeaveOptions = {
  onLeave: () => void
  /** Return false to ignore pulls (e.g. while the words are being edited). */
  enabled?: () => boolean
}

const FIELD_TAGS = new Set(['TEXTAREA', 'INPUT', 'SELECT'])

function startsInField(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!el) return false
  return FIELD_TAGS.has(el.tagName ?? '') || el.isContentEditable === true
}

/** The page scrolls inside the app's one container, so look up the tree for any scroll. */
function scrolledDown(host: PullHost): boolean {
  if (host.scrollTop > 0) return true
  let el = host.parentElement
  while (el) {
    if (el.scrollTop > 0) return true
    el = el.parentElement
  }
  return false
}

export function pullToLeave(node: PullHost, options: PullToLeaveOptions): { destroy(): void } {
  let pull: { y: number; dy: number } | null = null

  const onStart = (e: TouchEvent) => {
    if (options.enabled && !options.enabled()) return
    if (scrolledDown(node) || startsInField(e.target)) return
    pull = { y: e.touches[0].clientY, dy: 0 }
  }
  const onMove = (e: TouchEvent) => {
    if (!pull) return
    pull.dy = Math.max(0, e.touches[0].clientY - pull.y)
    if (pull.dy > 0 && e.cancelable) e.preventDefault()
    node.classList.add('is-pulling')
    node.style.setProperty('--pull', `${pullOffsetPx(pull.dy).toFixed(1)}px`)
  }
  const onEnd = () => {
    if (!pull) return
    const far = pullLeaves(pull.dy)
    pull = null
    node.classList.remove('is-pulling')
    if (far) options.onLeave()
    else node.style.removeProperty('--pull')
  }

  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: false })
  node.addEventListener('touchend', onEnd)

  return {
    destroy() {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
    },
  }
}

import type { BottomNavId } from './nav-active'

export type PageFadeView = BottomNavId | 'feedback' | null

/**
 * The shell mask's per-view fade vars (ei styles.css body[data-view] overrides):
 * mesh pages fade beneath their tabs; Ask, Capture and Contribute fade fully above
 * their docked writers. The writer publishes its live height — the quiet row above
 * the field (reading, duplicate card) included — so nothing scrolls legibly behind
 * the field or the text above it. Whole literals: Tailwind only sees full strings.
 */
export function pageFadeVars(view: PageFadeView): string {
  if (view === 'feedback') {
    return '[--fade-top:calc(var(--head,68px)+12px+var(--board-head-height,0px)-12px)] [--fade-bottom:calc(var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))+12px+var(--glass-writer-height,64px))] [--tail-bottom:0]'
  }
  if (view === 'ask' || view === 'capture') {
    return '[--fade-top:var(--head,68px)] [--fade-bottom:calc(var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))+12px+var(--glass-writer-height,64px))] [--tail-bottom:0.06]'
  }
  return '[--fade-top:var(--head,68px)] [--fade-bottom:var(--bottom-nav,calc(62px+env(safe-area-inset-bottom,0px)))] [--tail-bottom:0.06]'
}

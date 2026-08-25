/**
 * Shared filters for PostHog error tracking. Drops known-unactionable noise so
 * real regressions stay visible.
 */

const NOISE_MESSAGE_PATTERNS: RegExp[] = [
  /^ResizeObserver loop completed with undelivered notifications\.?$/i,
  /^ResizeObserver loop limit exceeded\.?$/i,
  /^Vite module runner has been closed\.?$/i,
  /transport was disconnected,\s*cannot call ["']fetchModule["']/i,
  /^Error invoking postMessage:\s*Java object is gone/i,
  /^Failed to fetch$/i,
  /^Load failed$/i, // Safari network abort
  /^NetworkError when attempting to fetch resource\.?$/i,
]

/** Stale stacks from deleted marketing / motion studio surfaces (moved off this repo). */
const STALE_STACK_MARKERS = [
  'src/lib/components/marketing/',
  'src/lib/components/motion/',
  'src/lib/motion/',
  'marketing-story-',
  'embedding-map-3d-preview',
  'studio-store',
]

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message: unknown }).message
    if (typeof m === 'string') return m
  }
  return String(error ?? '')
}

function stackOf(error: unknown): string {
  if (error instanceof Error && typeof error.stack === 'string') return error.stack
  if (error && typeof error === 'object' && 'stack' in error) {
    const s = (error as { stack: unknown }).stack
    if (typeof s === 'string') return s
  }
  return ''
}

/** True when this exception should not be sent to PostHog Error Tracking. */
export function isNoiseException(error: unknown): boolean {
  const message = messageOf(error).trim()
  if (NOISE_MESSAGE_PATTERNS.some((re) => re.test(message))) return true

  const stack = stackOf(error)
  if (stack && STALE_STACK_MARKERS.some((marker) => stack.includes(marker))) return true

  return false
}

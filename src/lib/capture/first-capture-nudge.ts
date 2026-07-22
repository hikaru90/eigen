/** localStorage key for dismissing the post-first-capture Chat/Memory nudge. */
export function firstCaptureNudgeDismissKey(userId: string): string {
  return `eigenmesh:first_capture_nudge_dismissed:${userId}`
}

export function isFirstCaptureNudgeDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(firstCaptureNudgeDismissKey(userId)) === '1'
  } catch {
    return false
  }
}

/** Client-side capture queue UI state helpers (testable, no IndexedDB). */

export type CaptureQueueUiState = {
  activeCaptureId: string | null
  pendingCount: number
  recentlyActivatedId: string | null
  recentlyActivatedAt: number
}

export const CAPTURE_QUEUE_ACTIVATION_GUARD_MS = 500

export function initialCaptureQueueUiState(): CaptureQueueUiState {
  return {
    activeCaptureId: null,
    pendingCount: 0,
    recentlyActivatedId: null,
    recentlyActivatedAt: 0,
  }
}

export function applyCaptureQueueSnapshot(
  state: CaptureQueueUiState,
  snapshot: { pending: number; processingId: string | null },
  now = Date.now(),
): CaptureQueueUiState {
  const next: CaptureQueueUiState = { ...state, pendingCount: snapshot.pending }
  if (snapshot.processingId != null) {
    return {
      ...next,
      activeCaptureId: snapshot.processingId,
      recentlyActivatedId: null,
    }
  }
  const guardActive =
    state.recentlyActivatedId != null &&
    state.activeCaptureId === state.recentlyActivatedId &&
    now - state.recentlyActivatedAt < CAPTURE_QUEUE_ACTIVATION_GUARD_MS
  if (!guardActive) {
    return { ...next, activeCaptureId: null }
  }
  return next
}

export function applyCaptureQueueActive(
  state: CaptureQueueUiState,
  id: string,
  now = Date.now(),
): CaptureQueueUiState {
  return {
    ...state,
    activeCaptureId: id,
    recentlyActivatedId: id,
    recentlyActivatedAt: now,
  }
}

export function shouldAcceptCaptureProgress(
  state: CaptureQueueUiState,
  captureId: string,
  now = Date.now(),
): boolean {
  if (state.activeCaptureId === captureId) return true
  return (
    state.recentlyActivatedId === captureId &&
    now - state.recentlyActivatedAt < CAPTURE_QUEUE_ACTIVATION_GUARD_MS
  )
}

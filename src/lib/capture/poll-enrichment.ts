import { fetchCaptureResult } from '$lib/capture/capture-result-api'

export const BACKGROUND_ENRICH_POLL_MS = 2500
export const BACKGROUND_ENRICH_TIMEOUT_MS = 5 * 60 * 1000

/** Poll until enrichment completes or timeout. Invokes onUpdate on each successful fetch. */
export function pollUntilEnrichmentComplete(input: {
  thoughtId: string
  onUpdate: (thought: Awaited<ReturnType<typeof fetchCaptureResult>>) => void
  onTimeout?: (thoughtId: string) => void
  pollMs?: number
  timeoutMs?: number
}): () => void {
  const pollMs = input.pollMs ?? BACKGROUND_ENRICH_POLL_MS
  const timeoutMs = input.timeoutMs ?? BACKGROUND_ENRICH_TIMEOUT_MS
  const startedAt = Date.now()
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (cancelled) return
    try {
      const thought = await fetchCaptureResult(input.thoughtId)
      input.onUpdate(thought)
      if (thought.enrichmentComplete) return
    } catch {
      // Transient poll errors — retry until timeout.
    }
    if (Date.now() - startedAt >= timeoutMs) {
      input.onTimeout?.(input.thoughtId)
      return
    }
    timer = setTimeout(() => {
      void tick()
    }, pollMs)
  }

  timer = setTimeout(() => {
    void tick()
  }, pollMs)

  return () => {
    cancelled = true
    if (timer !== undefined) clearTimeout(timer)
  }
}

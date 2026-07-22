export type StreamingSttSchedulerOptions = {
  /** Transcribe a cumulative audio blob; partial failures should resolve to empty string. */
  onTranscribe: (blob: Blob, signal: AbortSignal) => Promise<string>
  /** Called when a non-stale partial transcript is available (replaces prior partial). */
  onPartial?: (text: string) => void
}

export type StreamingSttScheduler = {
  appendChunk(chunk: Blob, mimeType: string): void
  reset(): void
  abort(): void
}

/**
 * Coalesces MediaRecorder timeslices into cumulative WebM blobs and schedules
 * partial STT requests without dropping audio or appending duplicate transcript text.
 */
export function createStreamingSttScheduler(
  options: StreamingSttSchedulerOptions,
): StreamingSttScheduler {
  let chunks: Blob[] = []
  let mimeType = 'audio/webm'
  let draining = false
  let pending = false
  /** Monotonic tag for in-flight requests; stale responses are ignored. */
  let requestGeneration = 0
  let abortController: AbortController | null = null

  function mergeBlob(): Blob | null {
    if (chunks.length === 0) return null
    return new Blob(chunks, { type: mimeType })
  }

  async function drain(): Promise<void> {
    if (draining) {
      pending = true
      return
    }
    draining = true

    try {
      while (true) {
        pending = false
        const blob = mergeBlob()
        if (!blob || blob.size === 0) break

        const thisGeneration = ++requestGeneration
        abortController?.abort()
        abortController = new AbortController()

        try {
          const partial = await options.onTranscribe(blob, abortController.signal)
          if (thisGeneration !== requestGeneration) continue
          const trimmed = partial.trim()
          if (trimmed) {
            options.onPartial?.(trimmed)
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') break
          console.error('streaming stt drain failed', err)
        }

        if (!pending) break
      }
    } finally {
      draining = false
    }
  }

  return {
    appendChunk(chunk, type) {
      chunks.push(chunk)
      mimeType = type
      if (draining) {
        requestGeneration++
      }
      void drain()
    },
    reset() {
      abortController?.abort()
      abortController = null
      chunks = []
      mimeType = 'audio/webm'
      requestGeneration++
      draining = false
      pending = false
    },
    abort() {
      abortController?.abort()
      abortController = null
      requestGeneration++
      draining = false
      pending = false
    },
  }
}

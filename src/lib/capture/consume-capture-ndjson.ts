import type { CaptureIngestPhase } from './ingest-phases'

export type CaptureNdjsonLine =
  | { type: 'progress'; phase: CaptureIngestPhase }
  | { type: 'progress_parallel'; phases: CaptureIngestPhase[] }
  | { type: 'done'; thought: unknown }
  | { type: 'error'; error: string; details?: string[] }

export type ProgressEvent =
  { parallel: false; phase: CaptureIngestPhase } | { parallel: true; phases: CaptureIngestPhase[] }

export async function consumeCaptureNdjsonStream<T>(
  res: Response,
  onProgress: (event: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<T> {
  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('Capture response had no body to read.')
  }

  // Cancel the reader when the caller aborts.
  signal?.addEventListener('abort', () => {
    void reader.cancel()
  })

  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      // reader.read() rejects with an AbortError when cancelled.
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const rawLine = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const line = rawLine.trim()
        if (!line) continue
        const obj = JSON.parse(line) as CaptureNdjsonLine
        if (obj.type === 'progress') {
          onProgress({ parallel: false, phase: obj.phase })
          continue
        }
        if (obj.type === 'progress_parallel') {
          onProgress({ parallel: true, phases: obj.phases })
          continue
        }
        if (obj.type === 'error') {
          throw new Error(obj.error || 'Capture failed')
        }
        if (obj.type === 'done') {
          return obj.thought as T
        }
      }
      if (done) break
    }
  } catch (e) {
    // Bubble up AbortError so the caller can detect cancellation.
    if (e instanceof Error && (e.name === 'AbortError' || signal?.aborted)) {
      const abortErr = new DOMException('Capture cancelled', 'AbortError')
      throw abortErr
    }
    throw e
  }
  if (signal?.aborted) {
    throw new DOMException('Capture cancelled', 'AbortError')
  }
  throw new Error('Capture stream ended before completion.')
}

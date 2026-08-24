import type { CaptureSubmitResult } from './types'
import { consumeCaptureNdjsonStream, type ProgressEvent } from '$lib/capture/consume-capture-ndjson'

export type SubmitCaptureOptions = {
  signal?: AbortSignal
  onProgress?: (event: ProgressEvent) => void
  /** When false, only JSON mode is used (service worker / background). */
  streamProgress?: boolean
}

export function isLikelyOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (err instanceof TypeError) return true
  return false
}

export async function parseCaptureErrorResponse(res: Response): Promise<string> {
  let serverMessage = ''
  try {
    const payload = (await res.json()) as { error?: unknown; details?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) serverMessage = payload.error
    else if (Array.isArray(payload.details)) {
      const first = payload.details.find((v) => typeof v === 'string')
      if (typeof first === 'string') serverMessage = first
    }
  } catch {
    serverMessage = await res.text()
  }
  return serverMessage || `Capture failed (${res.status})`
}

export async function submitCaptureRaw(
  raw: string,
  options?: SubmitCaptureOptions,
): Promise<CaptureSubmitResult> {
  const streamProgress = options?.streamProgress !== false
  const accept = streamProgress ? 'application/x-ndjson, application/json' : 'application/json'

  const res = await fetch('/api/capture/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept },
    body: JSON.stringify({ raw }),
    credentials: 'same-origin',
    signal: options?.signal,
  })

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/x-ndjson') && streamProgress) {
    return consumeCaptureNdjsonStream<CaptureSubmitResult>(
      res,
      (event) => {
        options?.onProgress?.(event)
      },
      options?.signal,
    )
  }

  if (!res.ok) {
    throw new Error(await parseCaptureErrorResponse(res))
  }

  const j = (await res.json()) as { thought: CaptureSubmitResult }
  return j.thought
}

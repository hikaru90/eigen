export type TranscribeAudioOptions = {
  language?: string
  signal?: AbortSignal
  /** Client segment index; sent in `x-audio-meta` and echoed by the server. */
  segment?: number
}

/** A failed `/api/capture/transcribe-chunk` request, keeping the HTTP status (402 = billing). */
export class TranscribeRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TranscribeRequestError'
    this.status = status
  }
}

/**
 * File extension derived from a Blob MIME type (used by e2e fixtures to name
 * audio files). Must match the bytes (e.g. WAV fixture must not be labeled
 * `.webm`).
 */
export function audioUploadExtension(mimeType: string): 'webm' | 'ogg' | 'wav' | 'mp4' {
  const type = mimeType.toLowerCase()
  if (type.includes('webm')) return 'webm'
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('wav') || type.includes('wave')) return 'wav'
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'mp4'
  return 'webm'
}

/**
 * Structured metadata for a binary audio upload. Sent in the `x-audio-meta`
 * JSON header instead of multipart form fields: raw audio content types
 * (`audio/*`, `application/octet-stream`) are exempt from SvelteKit's CSRF
 * origin check, which rejects cross-origin `multipart/form-data` POSTs with
 * "Cross-site POST form submissions are forbidden" whenever the deployed
 * `ORIGIN` does not exactly match the browser origin behind a proxy.
 */
export type AudioUploadMeta = { language?: string; segment?: number }

export function audioUploadHeaders(mimeType: string, meta?: AudioUploadMeta): HeadersInit {
  const headers: Record<string, string> = {
    'content-type': mimeType.trim() || 'application/octet-stream',
  }
  const language = meta?.language?.trim().toLowerCase()
  const payload: AudioUploadMeta = {}
  if (language) payload.language = language
  if (meta?.segment !== undefined) payload.segment = meta.segment
  if (Object.keys(payload).length > 0) {
    headers['x-audio-meta'] = JSON.stringify(payload)
  }
  return headers
}

/**
 * Combines a pre-existing draft with a voice transcript by appending the
 * transcript to the draft — audio capture must not overwrite text the user
 * already typed. Both sides are trimmed and separated by a single space.
 * Returns the draft unchanged when the transcript is empty, and the transcript
 * alone when the draft is empty. Voice partials are cumulative (the ordered
 * join of segment transcripts so far, not a delta), so this is recomputed from the original
 * draft on every partial — no duplication.
 */
export function appendVoiceTranscript(draft: string, transcript: string): string {
  const text = transcript.trim()
  if (!text) return draft
  const base = draft.trimEnd()
  if (!base) return text
  return `${base} ${text}`
}

export async function parseTranscribeErrorResponse(res: Response): Promise<string> {
  // Response bodies are one-shot — read once, then parse. Calling .json() then
  // .text() in a catch throws "Body has already been read" / similar.
  const raw = await res.text()
  let serverMessage = ''
  try {
    const payload = JSON.parse(raw) as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      serverMessage = payload.error
    }
  } catch {
    serverMessage = raw.trim()
  }
  return serverMessage || `Transcription failed (${res.status})`
}

/**
 * Sends one recorded segment (a standalone audio file) to
 * `/api/capture/transcribe-chunk` and returns its transcript. An empty string is
 * a valid result (silence). Any failure throws {@link TranscribeRequestError} —
 * never a silent empty partial.
 */
export async function transcribeAudioChunk(
  segment: Blob,
  options?: TranscribeAudioOptions,
): Promise<string> {
  const res = await fetch('/api/capture/transcribe-chunk', {
    method: 'POST',
    headers: audioUploadHeaders(segment.type, {
      language: options?.language,
      segment: options?.segment,
    }),
    body: segment,
    credentials: 'same-origin',
    signal: options?.signal,
  })

  if (!res.ok) {
    throw new TranscribeRequestError(res.status, await parseTranscribeErrorResponse(res))
  }

  const payload = (await res.json()) as { transcript?: unknown }
  if (typeof payload.transcript !== 'string') {
    throw new TranscribeRequestError(res.status, 'Transcription response missing transcript')
  }
  return payload.transcript.trim()
}

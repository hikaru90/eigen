export type TranscribeAudioOptions = {
  language?: string
  signal?: AbortSignal
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
export type AudioUploadMeta = { language?: string }

export function audioUploadHeaders(mimeType: string, meta?: AudioUploadMeta): HeadersInit {
  const headers: Record<string, string> = {
    'content-type': mimeType.trim() || 'application/octet-stream',
  }
  const language = meta?.language?.trim().toLowerCase()
  if (language) {
    headers['x-audio-meta'] = JSON.stringify({ language })
  }
  return headers
}

/**
 * Combines a pre-existing draft with a voice transcript by appending the
 * transcript to the draft — audio capture must not overwrite text the user
 * already typed. Both sides are trimmed and separated by a single space.
 * Returns the draft unchanged when the transcript is empty, and the transcript
 * alone when the draft is empty. Streaming partials are cumulative (the full
 * running transcript, not a delta), so this is recomputed from the original
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
 * Uploads recorded audio to `/api/capture/transcribe` and returns transcript text.
 */
export async function transcribeRecordedAudio(
  blob: Blob,
  options?: TranscribeAudioOptions,
): Promise<string> {
  const res = await fetch('/api/capture/transcribe', {
    method: 'POST',
    headers: audioUploadHeaders(blob.type, { language: options?.language }),
    body: blob,
    credentials: 'same-origin',
    signal: options?.signal,
  })

  if (!res.ok) {
    throw new Error(await parseTranscribeErrorResponse(res))
  }

  const payload = (await res.json()) as { transcript?: unknown }
  if (typeof payload.transcript !== 'string' || !payload.transcript.trim()) {
    throw new Error('Transcription response missing transcript')
  }
  return payload.transcript.trim()
}

/**
 * Sends a single audio chunk to `/api/capture/transcribe-chunk` for streaming STT.
 * Returns the partial transcript for that chunk (may be empty string for silence).
 */
export async function transcribeAudioChunk(
  chunk: Blob,
  options?: TranscribeAudioOptions,
): Promise<string> {
  const res = await fetch('/api/capture/transcribe-chunk', {
    method: 'POST',
    headers: audioUploadHeaders(chunk.type, { language: options?.language }),
    body: chunk,
    credentials: 'same-origin',
    signal: options?.signal,
  })

  if (!res.ok) {
    // Non-fatal for streaming — log and return empty so remaining chunks continue.
    console.error('transcribe-chunk failed', res.status)
    return ''
  }

  const payload = (await res.json()) as { transcript?: unknown }
  return typeof payload.transcript === 'string' ? payload.transcript.trim() : ''
}

/** A failed `/api/capture/transcribe` request, keeping the HTTP status (402 = billing). */
export class TranscribeRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'TranscribeRequestError'
    this.status = status
  }
}

/**
 * Combines a pre-existing draft with a voice transcript by appending the transcript to the
 * draft — a voice message must not overwrite text the user already typed. Both sides are
 * trimmed and separated by a single space. Returns the draft unchanged when the transcript
 * is empty, and the transcript alone when the draft is empty.
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
 * Sends one whole voice clip to `/api/capture/transcribe` and returns its transcript. An
 * empty string is a valid result (no speech). Any failure throws
 * {@link TranscribeRequestError} (or the network's own error) — never a silent empty text.
 *
 * The clip goes as the raw request body with its audio MIME type as `content-type`, not as
 * multipart: raw audio content types are exempt from SvelteKit's CSRF origin check, which
 * rejects cross-origin `multipart/form-data` POSTs ("Cross-site POST form submissions are
 * forbidden") whenever the deployed `ORIGIN` does not exactly match the browser origin
 * behind a proxy. No language hint is sent: the model identifies the spoken language.
 */
export async function transcribeVoiceClip(
  clip: Blob,
  options?: { signal?: AbortSignal },
): Promise<string> {
  const res = await fetch('/api/capture/transcribe', {
    method: 'POST',
    headers: { 'content-type': clip.type || 'application/octet-stream' },
    body: clip,
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

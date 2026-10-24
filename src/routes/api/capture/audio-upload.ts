import { error } from '@sveltejs/kit'
import { STT_SEGMENT_MAX_SECONDS } from '$lib/server/llm/stt-audio'

export type AudioUpload = {
  bytes: Uint8Array
  mimeType: string
  /** Client segment index (non-negative integer) from `x-audio-meta`, echoed back for assembly. */
  segment?: number
}

function tooLargeMessage(maxBytes: number): string {
  return `audio segment exceeds ${maxBytes} bytes (max ${STT_SEGMENT_MAX_SECONDS} s per segment)`
}

/**
 * Reads a voice-capture audio upload from a request body.
 *
 * The client sends the raw audio Blob as the body with the audio MIME type as
 * `content-type` and optional metadata in the `x-audio-meta` JSON header. Raw
 * audio content types are exempt from SvelteKit's CSRF origin check, unlike
 * `multipart/form-data`, which is rejected as a cross-site POST whenever the
 * deployed `ORIGIN` does not exactly match the browser origin (the production
 * failure on /capture voice input).
 */
export async function readAudioUpload(
  request: Request,
  maxBytes: number,
  mimeTypeForFormat: (mime: string) => string | null,
): Promise<AudioUpload> {
  const contentType = request.headers.get('content-type') ?? ''
  const baseType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''

  let formData: FormData | null = null
  if (baseType === 'multipart/form-data') {
    try {
      formData = await request.formData()
    } catch {
      error(400, 'Invalid form data')
    }
  }

  if (formData) {
    // Legacy path (kept for older clients / e2e tooling): audio file field.
    const audioEntry = formData.get('audio')
    if (!(audioEntry instanceof File)) error(400, 'audio file is required')
    if (audioEntry.size <= 0) error(400, 'audio file is empty')
    if (audioEntry.size > maxBytes) error(400, tooLargeMessage(maxBytes))

    const mimeType = audioEntry.type
    if (!mimeTypeForFormat(mimeType)) error(400, `unsupported audio type: ${mimeType || 'unknown'}`)
    return { bytes: new Uint8Array(await audioEntry.arrayBuffer()), mimeType }
  }

  // Binary body path: content-type carries the audio MIME, x-audio-meta the segment index.
  // No language hint is read: the model identifies the spoken language itself (a fixed
  // hint forced mixed-language speech into the wrong language and invited invented text).
  const audioBytes = new Uint8Array(await request.arrayBuffer())
  if (audioBytes.length === 0) error(400, 'audio file is empty')
  if (audioBytes.length > maxBytes) error(400, tooLargeMessage(maxBytes))
  if (!mimeTypeForFormat(baseType)) {
    error(400, `unsupported audio type: ${baseType || 'unknown'}`)
  }

  let segment: number | undefined
  const metaRaw = request.headers.get('x-audio-meta')
  if (metaRaw) {
    try {
      const parsed = JSON.parse(metaRaw) as { segment?: unknown }
      segment =
        typeof parsed.segment === 'number' && Number.isInteger(parsed.segment) && parsed.segment >= 0
          ? parsed.segment
          : undefined
    } catch {
      // Malformed metadata is not fatal — transcribe without a segment index.
    }
  }

  return { bytes: audioBytes, mimeType: baseType, segment }
}

import { error } from '@sveltejs/kit'
import { STT_CLIP_MAX_SECONDS } from '$lib/server/llm/stt-audio'

export type AudioUpload = {
  bytes: Uint8Array
  /** The audio MIME type from `content-type`, without parameters. */
  mimeType: string
  /** What the provider calls that type (`input_audio.format`). */
  format: string
}

function tooLargeMessage(maxBytes: number): string {
  return `audio clip exceeds ${maxBytes} bytes (max ${STT_CLIP_MAX_SECONDS / 60} minutes)`
}

/**
 * Reads a voice-message upload from a request body.
 *
 * The client sends the raw audio Blob as the body, with the audio MIME type as
 * `content-type` — nothing else. Raw audio content types are exempt from SvelteKit's CSRF
 * origin check, unlike `multipart/form-data`, which is rejected as a cross-site POST
 * whenever the deployed `ORIGIN` does not exactly match the browser origin (the production
 * failure on /capture voice input). No language hint is read: the model identifies the
 * spoken language itself.
 */
export async function readAudioUpload(
  request: Request,
  maxBytes: number,
  formatFromMime: (mime: string) => string | null,
): Promise<AudioUpload> {
  const contentType = request.headers.get('content-type') ?? ''
  const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const format = formatFromMime(mimeType)
  if (!format) error(400, `unsupported audio type: ${mimeType || 'unknown'}`)

  // an oversize clip is refused from its declared size, before it is read into memory
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) error(400, tooLargeMessage(maxBytes))

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length === 0) error(400, 'audio file is empty')
  if (bytes.length > maxBytes) error(400, tooLargeMessage(maxBytes))
  return { bytes, mimeType, format }
}

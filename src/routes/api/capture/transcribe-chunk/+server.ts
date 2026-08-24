import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import {
  billingErrorHttpStatus,
  billingErrorJsonBody,
} from '$lib/server/billing/insufficient-credits'
import { STT_MAX_AUDIO_BYTES, sttFormatFromMime } from '$lib/server/llm/stt-audio'
import { transcribeAudio } from '$lib/server/llm/stt-client'

const LANGUAGE_PATTERN = /^[a-z]{2}$/

/**
 * Max size for a streaming partial. The scheduler sends the **cumulative** audio
 * blob on every partial (not a single 2 s slice), so this must match the final
 * upload ceiling in {@link STT_MAX_AUDIO_BYTES} — otherwise longer recordings
 * 400 out once the cumulative blob outgrows a per-slice cap.
 */
const CHUNK_MAX_AUDIO_BYTES = STT_MAX_AUDIO_BYTES

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const contentType = event.request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    error(400, 'Expected multipart/form-data')
  }

  let formData: FormData
  try {
    formData = await event.request.formData()
  } catch {
    error(400, 'Invalid form data')
  }

  const audioEntry = formData.get('audio')
  if (!(audioEntry instanceof File)) {
    error(400, 'audio file is required')
  }
  if (audioEntry.size <= 0) {
    error(400, 'audio file is empty')
  }
  if (audioEntry.size > CHUNK_MAX_AUDIO_BYTES) {
    error(400, `chunk exceeds ${CHUNK_MAX_AUDIO_BYTES} bytes`)
  }

  const format = sttFormatFromMime(audioEntry.type)
  if (!format) {
    error(400, `unsupported audio type: ${audioEntry.type || 'unknown'}`)
  }

  const languageRaw = formData.get('language')?.toString().trim().toLowerCase() ?? ''
  const language = languageRaw && LANGUAGE_PATTERN.test(languageRaw) ? languageRaw : undefined

  const bytes = new Uint8Array(await audioEntry.arrayBuffer())

  try {
    const transcript = await transcribeAudio({
      userId: user.id,
      audio: { bytes, format, language },
    })
    return json({ transcript })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chunk transcription failed'
    console.error('capture transcribe-chunk failed', { userId: user.id, message })
    return json(billingErrorJsonBody(err, message), { status: billingErrorHttpStatus(err) })
  }
}

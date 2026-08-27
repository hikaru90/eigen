import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import {
  billingErrorHttpStatus,
  billingErrorJsonBody,
} from '$lib/server/billing/insufficient-credits'
import { STT_MAX_AUDIO_BYTES, sttFormatFromMime } from '$lib/server/llm/stt-audio'
import { transcribeAudio } from '$lib/server/llm/stt-client'
import { readAudioUpload } from '../audio-upload'

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

  const audio = await readAudioUpload(event.request, CHUNK_MAX_AUDIO_BYTES, sttFormatFromMime)
  const format = sttFormatFromMime(audio.mimeType)
  if (!format) {
    error(400, `unsupported audio type: ${audio.mimeType || 'unknown'}`)
  }

  try {
    const transcript = await transcribeAudio({
      userId: user.id,
      audio: { bytes: audio.bytes, format, language: audio.language },
    })
    return json({ transcript })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chunk transcription failed'
    console.error('capture transcribe-chunk failed', { userId: user.id, message })
    return json(billingErrorJsonBody(err, message), { status: billingErrorHttpStatus(err) })
  }
}

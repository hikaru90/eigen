import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import {
  billingErrorHttpStatus,
  billingErrorJsonBody,
} from '$lib/server/billing/insufficient-credits'
import { STT_SEGMENT_MAX_AUDIO_BYTES, sttFormatFromMime } from '$lib/server/llm/stt-audio'
import { transcribeAudio } from '$lib/server/llm/stt-client'
import { readAudioUpload } from '../audio-upload'

/**
 * Transcribes one voice segment (≤ 10 s, a standalone audio file). The client
 * cuts segments at pauses and sends each exactly once; one call = one
 * usage-log/billing entry. The optional client segment index is echoed back.
 */
export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const audio = await readAudioUpload(event.request, STT_SEGMENT_MAX_AUDIO_BYTES, sttFormatFromMime)
  const format = sttFormatFromMime(audio.mimeType)
  if (!format) {
    error(400, `unsupported audio type: ${audio.mimeType || 'unknown'}`)
  }

  try {
    const transcript = await transcribeAudio({
      userId: user.id,
      audio: { bytes: audio.bytes, format, language: audio.language },
    })
    return json(audio.segment === undefined ? { transcript } : { transcript, segment: audio.segment })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Segment transcription failed'
    console.error('capture transcribe-chunk failed', { userId: user.id, message })
    return json(billingErrorJsonBody(err, message), { status: billingErrorHttpStatus(err) })
  }
}

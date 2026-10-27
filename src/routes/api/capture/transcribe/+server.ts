import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { insufficientCreditsPayload, isInsufficientCreditsError } from '$lib/server/billing/insufficient-credits'
import { STT_CLIP_MAX_AUDIO_BYTES, sttFormatFromMime } from '$lib/server/llm/stt-audio'
import { transcribeAudio } from '$lib/server/llm/stt-client'
import { readAudioUpload } from '../audio-upload'

/** What the client is told when the provider failed all its attempts; the cause stays in the log. */
const TRANSCRIBE_FAILED_MESSAGE = 'Transcription failed'

/**
 * Transcribes one voice message: the whole clip (≤ 5 minutes), once. The client sends the
 * clip exactly once; the provider call retries up to 3 times in one layer
 * (`llmCreateTranscription`), and one clip is one usage-log/billing entry. The audio is
 * never stored and never logged — only the transcript leaves this handler.
 * Response: `200 { transcript }` (`""` = no speech); `400` empty / oversize / unsupported;
 * `401`; `402` billing; `502` when the provider still failed.
 */
export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const audio = await readAudioUpload(event.request, STT_CLIP_MAX_AUDIO_BYTES, sttFormatFromMime)

  try {
    const transcript = await transcribeAudio({
      userId: user.id,
      audio: { bytes: audio.bytes, format: audio.format },
    })
    return json({ transcript })
  } catch (err) {
    if (isInsufficientCreditsError(err)) {
      return json(insufficientCreditsPayload(err), { status: 402 })
    }
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('capture transcribe failed', { userId: user.id, message })
    return json({ error: TRANSCRIBE_FAILED_MESSAGE }, { status: 502 })
  }
}

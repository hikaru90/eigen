import type { VoiceFailure } from './voice-message'
import { m } from '$lib/paraglide/messages.js'

/**
 * The plain sentence for a failed voice message. The server's own words are shown only
 * where they say something the user can act on — a billing refusal (402) or a rejected
 * upload that names its limit (400); anything else a provider or the network said stays in
 * the logs.
 */
export function voiceFailureMessage(failure: VoiceFailure): string {
  switch (failure.reason) {
    case 'permission':
      return m.voice_error_permission()
    case 'microphone':
      return m.voice_error_microphone()
    case 'recorder':
      return m.voice_error_recorder()
    case 'interrupted':
      return m.voice_error_interrupted()
    case 'empty':
      return m.voice_error_empty()
    case 'request':
      return (failure.status === 402 || failure.status === 400) && failure.detail
        ? failure.detail
        : m.voice_error_transcribe()
  }
}

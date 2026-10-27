import { llmCreateTranscription } from './llm-client'

/**
 * OpenRouter model id for speech-to-text (`/audio/transcriptions`) — fixed in code, there is
 * no environment override. It must have live endpoints that accept browser `webm`/opus and
 * Safari `m4a` uploads and pass the workspace ZDR guardrail. Qwen3 ASR 1.7B (2026-10-24):
 * ASR + language-ID only — it has no translate task, so speech is transcribed verbatim
 * instead of auto-translated (whisper-large-v3 did that; before it,
 * `qwen/qwen3-asr-0.6b` ignored the `language` hint and invented text on quiet audio).
 */
export const STT_MODEL = 'qwen/qwen3-asr-1.7b'

export type SttAudioInput = {
  bytes: Uint8Array
  format: string
}

/**
 * Parses transcript text from a dedicated STT body (`{ text }` only; `""` = no speech).
 * Chat-completion shaped bodies are rejected — they often contain assistant replies, not verbatim speech.
 */
export function parseSttTranscript(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('STT response missing body')
  }
  const dedicated = (body as { text?: unknown }).text
  // an empty string is a real answer: the clip held no speech
  if (typeof dedicated === 'string') {
    return dedicated.trim()
  }
  if ('choices' in body) {
    throw new Error(
      'STT response used chat completion shape; configure a dedicated /audio/transcriptions model',
    )
  }
  throw new Error('STT response missing transcript text')
}

/**
 * Transcribes audio via OpenRouter (`POST /audio/transcriptions`).
 */
export async function transcribeAudio(input: {
  userId: string
  audio: SttAudioInput
}): Promise<string> {
  const body = await llmCreateTranscription({
    userId: input.userId,
    model: STT_MODEL,
    audio: input.audio,
  })
  return parseSttTranscript(body)
}

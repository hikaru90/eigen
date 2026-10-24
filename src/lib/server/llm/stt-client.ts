import { env } from '$lib/server/env/private-env'
import { llmCreateTranscription } from './llm-client'

/**
 * OpenRouter model id for speech-to-text (`/audio/transcriptions`).
 * Must have live endpoints that accept browser `webm`/opus and Safari `m4a` uploads and
 * pass the workspace ZDR guardrail. Whisper large-v3 (2026-10-24): it returns an empty
 * transcript for silent segments and transcribes German/English verbatim. The previous
 * `qwen/qwen3-asr-0.6b` ignored the `language` hint and invented text on quiet segments
 * (Spanish "Ahora.", Chinese) — the segmenter cuts at pauses, so it saw many of those.
 */
export const STT_MODEL_OPENROUTER_DEFAULT = 'openai/whisper-large-v3'

export type SttAudioInput = {
  bytes: Uint8Array
  format: string
  language?: string
}

function sttModelId(): string {
  const override = env.LLM_MODEL_STT?.trim()
  if (!override) return STT_MODEL_OPENROUTER_DEFAULT
  return override
}

/**
 * Parses transcript text from a dedicated STT body (`{ text }` only).
 * Chat-completion shaped bodies are rejected — they often contain assistant replies, not verbatim speech.
 */
export function parseSttTranscript(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('STT response missing body')
  }
  const dedicated = (body as { text?: unknown }).text
  if (typeof dedicated === 'string' && dedicated.trim()) {
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
    model: sttModelId(),
    audio: input.audio,
  })
  return parseSttTranscript(body)
}

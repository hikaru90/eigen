import {
  CUES_FROM_CAPTURE_RULE,
  capturePrimaryPromptBlock,
} from '$lib/server/capture/enrichment-prompt-sections'
/**
 * Search cue phrases for a thought (lexical recall diversification).
 *
 * Cues normally arrive inside the single enrich bundle LLM call (`extractEnrichThoughtBundle`).
 * This module owns the shared parsing contract plus a cues-only LLM fallback for paths that
 * re-enrich an edited thought without a fresh bundle (reenrichThought).
 */
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'

export const MIN_CUE_LENGTH = 3
export const MAX_CUE_LENGTH = 80
export const MAX_CUES = 5

/** Parse the LLM `cues` array: strings only, trimmed, length-bounded, capped. */
export function parseSearchCues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_CUE_LENGTH && s.length <= MAX_CUE_LENGTH)
    .slice(0, MAX_CUES)
}

/**
 * Cues-only LLM call for the re-enrich fallback path (edited thoughts). Never emits any
 * type label — the single type axis (category) is classified elsewhere.
 */
export async function extractSearchCues(input: {
  userId: string
  normalizedText: string
}): Promise<string[]> {
  const prompt = [
    capturePrimaryPromptBlock({ normalizedText: input.normalizedText }),
    '',
    'Return ONLY JSON with this shape:',
    '{',
    '  "cues": ["2-8 word search phrase", "..."]',
    '}',
    '',
    CUES_FROM_CAPTURE_RULE,
  ].join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content:
          'You generate short search cue phrases for personal memory notes. Return only valid JSON.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'search_cues',
  })

  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('extractSearchCues: no choices in response')
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content
  if (typeof content !== 'string') {
    throw new Error('extractSearchCues: content is not a string')
  }
  const parsed = JSON.parse(stripMarkdownJsonFences(content)) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('extractSearchCues: output must be a JSON object')
  }
  return parseSearchCues((parsed as Record<string, unknown>).cues)
}

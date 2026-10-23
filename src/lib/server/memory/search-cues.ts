import {
  CUES_FROM_CAPTURE_RULE,
  capturePrimaryPromptBlock,
} from '$lib/server/capture/enrichment-prompt-sections'
/**
 * Recall aids for a thought: search cue phrases (lexical recall diversification) and the
 * suggested question shown on Ask.
 *
 * Both normally arrive inside the single enrich bundle LLM call (`extractEnrichThoughtBundle`).
 * This module owns the cue parsing contract plus the one recall LLM call for paths that
 * re-enrich an edited thought without a fresh bundle (reenrichThought).
 */
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { ASK_QUESTION_RULE, parseAskQuestion } from '$lib/server/memory/ask-question'
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

export type RecallCues = { cues: string[]; askQuestion: string | null }

/**
 * Recall LLM call for the re-enrich path (edited thoughts): cues + Ask question in one call.
 * Never emits any type label — the single type axis (category) is classified elsewhere.
 */
export async function extractRecallCues(input: {
  userId: string
  normalizedText: string
}): Promise<RecallCues> {
  const prompt = [
    capturePrimaryPromptBlock({ normalizedText: input.normalizedText }),
    '',
    'Return ONLY JSON with this shape:',
    '{',
    '  "cues": ["2-8 word search phrase", "..."],',
    '  "askQuestion": "<short question in the capture\'s language>" | null',
    '}',
    '',
    CUES_FROM_CAPTURE_RULE,
    '',
    ASK_QUESTION_RULE,
  ].join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content:
          'You generate short search cue phrases and one recall question for personal memory notes. Return only valid JSON.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'search_cues',
  })

  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('extractRecallCues: no choices in response')
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content
  if (typeof content !== 'string') {
    throw new Error('extractRecallCues: content is not a string')
  }
  const parsed = JSON.parse(stripMarkdownJsonFences(content)) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('extractRecallCues: output must be a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  return { cues: parseSearchCues(obj.cues), askQuestion: parseAskQuestion(obj) }
}

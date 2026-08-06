/**
 * Memory type classification.
 *
 * Classifies a captured thought into one of the structured memory types
 * (see MEMORY_TYPE_KEYS / memoryTypeEnum). Used by consolidation, retrieval
 * weighting, and community summary prompts.
 *
 * Prefer extractThoughtMetadata / enrich-thought-bundle in the capture path;
 * this standalone classifier remains for callers that only need the type key.
 */

import { llmChatCompletion } from '$lib/server/llm/llm-client'
import type { MemoryType } from '$lib/server/db/brain.schema'
import { MEMORY_TYPE_KEYS, normalizeMemoryType } from '$lib/server/memory/memory-type-catalog'

/**
 * Returns the memory type for a thought.
 * Throws if the LLM call fails or returns an invalid type — callers should catch.
 */
export async function classifyMemoryType(input: {
  userId: string
  normalizedText: string
}): Promise<MemoryType> {
  const prompt = [
    'Classify this personal memory note into exactly one of these types:',
    '  episode    — a specific event or experience that happened',
    '  fact       — a standing truth, reference, or factual note',
    '  decision   — a committed choice or resolution',
    '  concern    — a worry, risk, or anxiety',
    '  preference — a personal tendency, habit, or like/dislike',
    '  pattern    — a recurring observation about oneself or a situation',
    '  task       — actionable open work, a to-do, or work in progress',
    '',
    'Return ONLY the single type key, no other text.',
    '',
    `Note: ${input.normalizedText}`,
  ].join('\n')

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      {
        role: 'system',
        content: 'You classify personal memory notes. Return only the type key, nothing else.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
  })

  const choices = (response as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('classifyMemoryType: no choices in response')
  }
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content
  if (typeof content !== 'string') {
    throw new Error('classifyMemoryType: content is not a string')
  }

  const memoryType = normalizeMemoryType(content)
  if (!memoryType) {
    throw new Error(`classifyMemoryType: unexpected type "${content.trim().toLowerCase()}"`)
  }
  // Exhaustiveness guard — normalizeMemoryType already constrains to MEMORY_TYPE_KEYS.
  if (!(MEMORY_TYPE_KEYS as readonly string[]).includes(memoryType)) {
    throw new Error(`classifyMemoryType: unexpected type "${memoryType}"`)
  }
  return memoryType
}

/**
 * Exactly one strict forced-choice LLM retry when category validation rejects every candidate.
 * Shared by interpret preview and enrich bundle — same contract, no synonym remapping.
 */
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import type { LoadedUserOntology } from '$lib/server/ontology-db/load-ontology'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import {
  buildStrictCategoryRetryPrompt,
  resolveCategoryFromLlmOutput,
  type ResolvedThoughtCategory,
} from '$lib/server/ontology/validate-thought-category'

export async function runStrictCategoryRetry(input: {
  userId: string
  normalizedText: string
  allowedKeys: readonly string[]
  ontology: LoadedUserOntology
  logContext: string
}): Promise<ResolvedThoughtCategory> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You assign exactly one ontology thought category key per capture for a personal memory system. Output JSON only.',
    },
    {
      role: 'user',
      content: buildStrictCategoryRetryPrompt({
        normalizedText: input.normalizedText,
        allowedKeys: input.allowedKeys,
      }),
    },
  ]
  const response = await llmChatCompletion({
    userId: input.userId,
    messages,
    temperature: 0,
    logContext: input.logContext,
    responseFormat: 'json_object',
  })
  const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Category retry: output must be a JSON object')
  }
  return resolveCategoryFromLlmOutput(input.ontology, parsed)
}

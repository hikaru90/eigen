/**
 * Personalization query expansion — one LLM call that turns an advice question into 2-4
 * retrieval sub-queries describing what ABOUT THE USER would matter. The LLM writes the
 * sub-queries; code only validates the JSON contract. The question text is the only input.
 */

import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'

export const MIN_EXPANSION_QUERIES = 2
export const MAX_EXPANSION_QUERIES = 4

export const PERSONALIZATION_EXPANSION_PROMPT = [
  'You help a personal memory assistant look up what it knows about a user before it answers an advice or recommendation question. Return JSON only — no markdown fences.',
  '',
  "You see ONLY the user's question. Write 2 to 4 short retrieval queries, each describing a kind of thing ABOUT THE USER that would matter for answering the question well: preferences, health conditions and limits, habits and routines, constraints, circumstances, past experiences.",
  'Each query is a descriptive phrase about the user — not a rewording of the question and not an answer. Different queries cover different aspects.',
  'Examples (for an advice question about what to eat before a trip): "health conditions affecting energy", "foods the user avoids", "physical activities the user enjoys on trips".',
  'Do not assert facts about the user and do not guess specifics; describe what to look up. Write the queries in the language of the question.',
  '',
  'Return exactly: {"queries":["...","..."]}',
].join('\n')

export function parseExpansionQueriesResponse(text: string): string[] {
  const parsed = parseLlmJsonPayload(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('personalization expansion: response is not a JSON object with "queries"')
  }
  const raw = (parsed as Record<string, unknown>).queries
  if (!Array.isArray(raw)) {
    throw new Error('personalization expansion: "queries" must be an array')
  }
  if (raw.length < MIN_EXPANSION_QUERIES || raw.length > MAX_EXPANSION_QUERIES) {
    throw new Error(
      `personalization expansion: "queries" must contain ${MIN_EXPANSION_QUERIES} to ${MAX_EXPANSION_QUERIES} items, got ${raw.length}`,
    )
  }
  const queries = raw.map((q) => (typeof q === 'string' ? q.trim() : ''))
  if (queries.some((q) => q.length === 0)) {
    throw new Error('personalization expansion: "queries" must be non-empty strings')
  }
  return queries
}

export async function expandPersonalizationQueries(params: {
  userId: string
  question: string
}): Promise<string[]> {
  const question = params.question.trim()
  if (!question) {
    throw new Error('expandPersonalizationQueries: question must be non-empty')
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: PERSONALIZATION_EXPANSION_PROMPT },
    { role: 'user', content: question },
  ]
  const raw = await llmChatCompletion({
    userId: params.userId,
    messages,
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'personalization_query_expansion',
  })
  return evictOnReject(raw, () => {
    const content =
      (
        raw as { choices?: Array<{ message?: { content?: string } }> }
      )?.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) {
      throw new Error('personalization expansion: empty LLM response')
    }
    return parseExpansionQueriesResponse(content)
  })
}

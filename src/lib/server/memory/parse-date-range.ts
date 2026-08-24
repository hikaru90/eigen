import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { parsedDateRangeSchema, type ParsedDateRangeBody } from '$lib/validation/api-bodies'

export type ParsedDateRange = ParsedDateRangeBody

/** Shared copy for gateway/proxy failures on the free-text parse path. */
export const PARSE_DATE_RANGE_GATEWAY_USER_ERROR =
  'Date parsing is temporarily unavailable. Try Last week / Last month, or try again.'

export function parseDateRangePayload(raw: unknown): ParsedDateRange {
  const parsed = parsedDateRangeSchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid date range payload'
    throw new Error(`Invalid date range payload: ${message}`)
  }
  return parsed.data
}

/** True when the shared LLM client / proxy failed in a retryable gateway way. */
export function isParseDateRangeGatewayFailure(message: string): boolean {
  return (
    /LLM HTTP 502\b/i.test(message) ||
    /LLM HTTP 503\b/i.test(message) ||
    /LLM HTTP 504\b/i.test(message) ||
    /timed out after \d+ms/i.test(message) ||
    /bad gateway/i.test(message)
  )
}

/**
 * Free-text NL → absolute timeline range via the same `llmChatCompletion` path
 * used by capture, enrichment, MCP, and chat (EUrouter/OpenRouter from user LLM config).
 * Dial presets must not call this — use `computePresetAbsoluteRange` instead.
 */
export async function parseDateRangePhrase(input: {
  userId: string
  phrase: string
  nowIso: string
  timeZone: string
}): Promise<ParsedDateRange> {
  const phrase = input.phrase.trim()
  if (!phrase) {
    throw new Error('Date range phrase is required')
  }

  const messages = [
    {
      role: 'system' as const,
      content: [
        'You convert natural-language date-range phrases into absolute bounds for a timeline filter.',
        'Respond with JSON only matching:',
        '{ "from": string|null, "to": string|null, "includeUndated": boolean, "label": string }',
        'from/to must be ISO-8601 datetimes in UTC, or null for unbounded.',
        'includeUndated=true when undated tasks should appear for this phrase (e.g. open work / relevant); false for historical windows like "last week".',
        'label is a short human display string for the dial.',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
        `Now (ISO): ${input.nowIso}`,
        `Viewer timezone: ${input.timeZone}`,
        `Phrase: ${phrase}`,
      ].join('\n'),
    },
  ]

  const response = await llmChatCompletion({
    userId: input.userId,
    messages,
    temperature: 0,
    maxTokens: 256,
    responseFormat: 'json_object',
    logContext: 'timeline_parse_date_range',
  })

  const content = extractChatContent(response)
  try {
    return parseDateRangePayload(parseLlmJsonPayload(content))
  } catch (err) {
    throw new Error(
      `Invalid date range LLM response: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }
}

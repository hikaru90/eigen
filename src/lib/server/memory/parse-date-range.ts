import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { extractChatContent } from '$lib/server/ontology/llm-json'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { parsedDateRangeSchema, type ParsedDateRangeBody } from '$lib/validation/api-bodies'

export type ParsedDateRange = ParsedDateRangeBody

export function parseDateRangePayload(raw: unknown): ParsedDateRange {
  const parsed = parsedDateRangeSchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid date range payload'
    throw new Error(`Invalid date range payload: ${message}`)
  }
  return parsed.data
}

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
    responseFormat: 'json_object',
    logContext: 'timeline_parse_date_range',
  })

  const content = extractChatContent(response)
  try {
    return parseDateRangePayload(parseLlmJsonPayload(content))
  } catch (err) {
    throw new Error(
      `Invalid date range LLM response: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

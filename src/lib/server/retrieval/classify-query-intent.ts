/**
 * Unified LLM query classifier — retrieval scope + temporal intent in one call.
 */

import { parseOptionalIsoTimestampOrNull } from '$lib/server/datetime/parse-iso'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import type { RetrievalScope } from '$lib/server/retrieval/global-query'

export type TemporalQuestionKind =
  'ordering' | 'multi_ordering' | 'duration' | 'count' | 'lookback' | 'span' | 'absolute' | 'none'

export type DurationUnit = 'days' | 'weeks' | 'months'

export type QueryIntent = {
  scope: RetrievalScope
  temporal: boolean
  kind: TemporalQuestionKind
  entityHints: string[]
  timeWindow: { start: Date; end: Date } | null
  /** Output unit for duration/lookback questions (from LLM classifier). */
  durationUnit: DurationUnit | null
  /** True when the question compares which of two+ named alternatives came first (A or B). */
  comparativeOrdering: boolean
}

export const QUERY_INTENT_CLASSIFIER_PROMPT = [
  'You classify questions for a personal memory assistant. Return JSON only — no markdown fences.',
  '',
  'Return exactly one object with these keys:',
  '{"scope":"global"|"local","temporal":boolean,"kind":"ordering"|"multi_ordering"|"duration"|"count"|"lookback"|"span"|"absolute"|"none","entityHints":string[],"durationUnit":"days"|"weeks"|"months"|null,"comparativeOrdering":boolean}',
  '',
  'scope global — Corpus-wide sensemaking: themes, patterns, self-profile synthesis. Requires integrating many memories.',
  'scope local — Specific fact lookup answerable from one or a few stored thoughts.',
  '',
  'temporal true — Question requires comparing dates, ordering events in time, counting days/weeks between events, or when something happened relative to another event.',
  'temporal false — No timeline comparison or date arithmetic needed.',
  '',
  'kind ordering — Which of two named events/things came first (e.g. "which did I attend first, A or B", "coffee maker or stand mixer").',
  'kind multi_ordering — Order of three or more named events from earliest to latest (e.g. "order of the three trips").',
  'kind duration — How many days/weeks/months between two events, or before/after two anchors.',
  'kind count — How many events of a type occurred before a named anchor (e.g. "how many charity events before Run for the Cure").',
  'kind lookback — How many months/weeks/days ago something happened relative to now (e.g. "how many months ago did I book the Airbnb").',
  'kind span — How long between two career/life milestones (e.g. "how long working before I started at NovaTech"). Include BOTH interval endpoints in entityHints.',
  'kind absolute — What/when was a specific thing (identity or date lookup), including "what was the first [issue/problem] after [event]" — answer is a description, NOT picking which of two events came first.',
  'kind none — Not a temporal reasoning question.',
  '',
  'entityHints — Verbatim product/entity/event names copied from the question in the same language (quoted names, "X or Y" / "X oder Y" alternatives, "before …" / "nach …" anchors). Include ALL endpoints for duration, span, and multi_ordering. For count, include the anchor event name. Empty array if none.',
  'durationUnit — Always "days", "weeks", or "months" (English keys) when the question asks for that unit in any language (e.g. German "Tage" → "days", "Wochen" → "weeks", "Monate" → "months"); null otherwise.',
  'comparativeOrdering — true when the question asks which of two or more named alternatives came first (e.g. "bike or car", "Fahrrad oder Auto", "Samsung or Dell"). false for "what was the first issue after …" / "was war das erste Problem nach …" and other fact-after-anchor lookups (use kind absolute).',
  'timeWindowStart/timeWindowEnd — Optional ISO-8601 UTC strings when the question implies a calendar window. Leave both keys out entirely when unknown; never use placeholder text.',
  '',
  'Questions may be in any language. Classify by intent, not by keywords or language.',
  '',
  'span vs lookback — span measures elapsed time BETWEEN two milestones (e.g. career start and job start). lookback measures distance from ONE past event to now. "How long working before I started at NovaTech" is span, NOT lookback.',
  '',
  'English examples:',
  '- "How many days had passed between the \'Walk for Hunger\' event and the \'Coastal Cleanup\' event?" → kind duration, durationUnit "days", entityHints ["Walk for Hunger","Coastal Cleanup"], comparativeOrdering false.',
  '- "How long have I been working before I started my current job at NovaTech?" → kind span, entityHints ["working professionally","NovaTech"], comparativeOrdering false.',
  '- "How many months ago did I book the Airbnb in San Francisco?" → kind lookback, durationUnit "months", entityHints ["Airbnb in San Francisco"], comparativeOrdering false.',
  '- "Which book did I finish reading first, \'The Hate U Give\' or \'The Nightingale\'?" → kind ordering, entityHints ["The Hate U Give","The Nightingale"], comparativeOrdering true.',
  '- "How many days did it take for me to find a house I loved after starting to work with Rachel?" → kind duration, durationUnit "days", entityHints ["starting to work with Rachel","find a house I loved"], comparativeOrdering false.',
  '- "Which item did I purchase first, the dog bed for Max or the training pads for Luna?" → kind ordering, entityHints ["dog bed for Max","training pads for Luna"], comparativeOrdering true.',
  '- "Which task did I complete first, fixing the fence or trimming the goats\' hooves?" → kind ordering, entityHints ["fixing the fence","trimming the goats\' hooves"], comparativeOrdering true.',
  '- "What was the first issue I had with my new car after its first service?" → kind absolute, entityHints include anchor events as needed, comparativeOrdering false.',
  '- "Which pair of shoes did I clean last month?" → kind absolute, temporal false or kind absolute with temporal true if date matters, comparativeOrdering false.',
  'German examples:',
  '- "Welches Gerät habe ich zuerst bekommen, das Samsung Galaxy S22 oder den Dell XPS 13?" → kind ordering, comparativeOrdering true, entityHints ["Samsung Galaxy S22","Dell XPS 13"].',
  '- "Welches Fahrzeug habe ich im Februar zuerst gewartet, das Fahrrad oder das Auto?" → kind ordering, entityHints ["Fahrrad","Auto"].',
  '- "Wie viele Tage lagen zwischen dem Workshop über effektive Kommunikation und dem Team-Meeting?" → kind duration, durationUnit "days", entityHints include both event names.',
].join('\n')

export function parseQueryIntentResponse(text: string): QueryIntent {
  const parsed = parseLlmJsonPayload(text)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('query intent classifier: response is not a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const scope = obj.scope
  if (scope !== 'global' && scope !== 'local') {
    throw new Error('query intent classifier: scope must be "global" or "local"')
  }
  const temporal = obj.temporal
  if (typeof temporal !== 'boolean') {
    throw new Error('query intent classifier: temporal must be a boolean')
  }
  const kindRaw = obj.kind
  const validKinds = [
    'ordering',
    'multi_ordering',
    'duration',
    'count',
    'lookback',
    'span',
    'absolute',
    'none',
  ] as const satisfies readonly TemporalQuestionKind[]
  if (!validKinds.includes(kindRaw as TemporalQuestionKind)) {
    throw new Error(
      'query intent classifier: kind must be ordering, multi_ordering, duration, count, lookback, span, absolute, or none',
    )
  }
  const kind = kindRaw as TemporalQuestionKind
  const rawHints = obj.entityHints
  if (!Array.isArray(rawHints)) {
    throw new Error('query intent classifier: entityHints must be an array')
  }
  const entityHints = rawHints
    .filter((h): h is string => typeof h === 'string')
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
  const start = parseOptionalIsoTimestampOrNull(obj.timeWindowStart)
  const end = parseOptionalIsoTimestampOrNull(obj.timeWindowEnd)
  const timeWindow =
    start && end
      ? start.getTime() <= end.getTime()
        ? { start, end }
        : { start: end, end: start }
      : null
  const rawUnit = obj.durationUnit
  const durationUnit =
    rawUnit === 'days' || rawUnit === 'weeks' || rawUnit === 'months' ? rawUnit : null
  const comparativeOrdering = obj.comparativeOrdering
  if (typeof comparativeOrdering !== 'boolean') {
    throw new Error('query intent classifier: comparativeOrdering must be a boolean')
  }
  return { scope, temporal, kind, entityHints, timeWindow, durationUnit, comparativeOrdering }
}

export async function classifyQueryIntent(params: {
  userId: string
  query: string
}): Promise<QueryIntent> {
  const query = params.query.trim()
  if (!query) {
    throw new Error('classifyQueryIntent: query must be non-empty')
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: QUERY_INTENT_CLASSIFIER_PROMPT },
    { role: 'user', content: query },
  ]

  const raw = await llmChatCompletion({
    userId: params.userId,
    messages,
    temperature: 0,
    logContext: 'query_intent_classifier',
  })

  const content =
    (
      raw as { choices?: Array<{ message?: { content?: string } }> }
    )?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) {
    throw new Error('query intent classifier: empty LLM response')
  }

  return parseQueryIntentResponse(content)
}

/** Back-compat wrapper — prefer classifyQueryIntent for temporal-aware routing. */
export async function classifyRetrievalScopeFromIntent(params: {
  userId: string
  query: string
}): Promise<RetrievalScope> {
  const intent = await classifyQueryIntent(params)
  return intent.scope
}

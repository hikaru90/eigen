/**
 * Unified LLM query classifier — retrieval scope + temporal intent in one call.
 */

import { parseOptionalIsoTimestampOrNull } from '$lib/server/datetime/parse-iso'
import {
  resolveDecisionEnforceKinds,
  type DecisionChoiceAnswer,
} from '$lib/server/llm/decision-client'
import { runEnforcedBoundedDecisions } from '$lib/server/llm/decision-plane'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
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
  /**
   * True when a good answer depends on who the user is (preferences, health, habits, constraints,
   * circumstances) rather than on one stored fact — triggers retrieval query expansion.
   */
  personalization: boolean
}

export const QUERY_INTENT_CLASSIFIER_PROMPT = [
  'You classify questions for a personal memory assistant. Return JSON only — no markdown fences.',
  '',
  'Return exactly one object with these keys:',
  '{"scope":"global"|"local","temporal":boolean,"kind":"ordering"|"multi_ordering"|"duration"|"count"|"lookback"|"span"|"absolute"|"none","entityHints":string[],"durationUnit":"days"|"weeks"|"months"|null,"comparativeOrdering":boolean,"personalization":boolean}',
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
  'personalization true — A good answer depends on who the user is (their preferences, health, habits, constraints, circumstances, past experiences) rather than on one stored fact: advice, recommendations, suggestions, "what should I …", "which would suit me", help choosing or planning something for themselves.',
  "personalization false — The answer is a fact lookup, a recall of a specific event or detail, a timeline question, general knowledge, or about a third party, and does not depend on the user's own profile.",
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
  '- "What should I eat before my morning run?" → personalization true (the answer depends on the user\'s health, diet and habits), kind none.',
  '- "Which hobby could I pick up this winter?" → personalization true.',
  '- "What is the name of my dentist?" → personalization false (one stored fact), kind absolute or none.',
  '- "How many days between my move and my new job?" → personalization false.',
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
  const personalization = obj.personalization
  if (typeof personalization !== 'boolean') {
    throw new Error('query intent classifier: personalization must be a boolean')
  }
  return {
    scope,
    temporal,
    kind,
    entityHints,
    timeWindow,
    durationUnit,
    comparativeOrdering,
    personalization,
  }
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
    responseFormat: 'json_object',
    logContext: 'query_intent_classifier',
  })

  const parsed = evictOnReject(raw, () => {
    const content =
      (
        raw as { choices?: Array<{ message?: { content?: string } }> }
      )?.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) {
      throw new Error('query intent classifier: empty LLM response')
    }

    return parseQueryIntentResponse(content)
  })

  // Enforced bounded half: when any qa kind is decision-model authoritative,
  // ONE additional Decisions call overrides scope/kind/durationUnit. No
  // try/catch — an enforced failure propagates (retrieval is critical path;
  // same posture as an LLM gateway outage). Off: zero calls, zero change.
  const enforceKinds = resolveDecisionEnforceKinds()
  if (
    enforceKinds.has('retrieval_scope') ||
    enforceKinds.has('query_temporal_kind') ||
    enforceKinds.has('duration_unit')
  ) {
    const answers = await runEnforcedBoundedDecisions({
      userId: params.userId,
      surface: 'qa_intent',
      state: query,
      specs: [
        {
          decisionKind: 'retrieval_scope',
          id: 'scope',
          question: ENFORCED_SCOPE_QUESTION,
          llmChoice: parsed.scope,
          llmConfidence: null,
        },
        {
          decisionKind: 'query_temporal_kind',
          id: 'temporal_kind',
          question: ENFORCED_TEMPORAL_KIND_QUESTION,
          llmChoice: parsed.kind,
          llmConfidence: null,
        },
        {
          decisionKind: 'duration_unit',
          id: 'duration_unit',
          question: ENFORCED_DURATION_UNIT_QUESTION,
          llmChoice: parsed.durationUnit ?? 'none',
          llmConfidence: null,
        },
      ],
    })

    // The plane validates every choice against the criteria catalogs above
    // (off-catalog throws), so these narrows are total.
    const scope = enforcedChoiceOrThrow(answers, 'scope') as RetrievalScope
    const kind = enforcedChoiceOrThrow(answers, 'temporal_kind') as TemporalQuestionKind
    const unitChoice = enforcedChoiceOrThrow(answers, 'duration_unit')
    const durationUnit = unitChoice === 'none' ? null : (unitChoice as DurationUnit)
    return { ...parsed, scope, kind, durationUnit }
  }

  return parsed
}

// Enforced bounded half (DECISION_ENFORCE_KINDS): the decision model answers
// the closed-catalog classifications; the chat classifier keeps the
// open-ended extractions (temporal flag, entityHints, timeWindow,
// comparativeOrdering). Criteria keys double as the validity catalog —
// runEnforcedBoundedDecisions throws on off-catalog choices.
const ENFORCED_SCOPE_QUESTION = {
  type: 'choice',
  instructions:
    "Should this question be answered from the user's entire memory, or narrowly from the current conversational context?",
  criteria: {
    global: "The answer may draw on the user's whole stored memory.",
    local: 'The answer should come only from the immediate conversation context.',
  },
} as const

const ENFORCED_TEMPORAL_KIND_QUESTION = {
  type: 'choice',
  instructions: 'Which temporal reasoning does this question require?',
  criteria: {
    ordering: 'Asks which of several events happened first.',
    multi_ordering: 'Asks to order many events.',
    duration: 'Asks how long something lasted.',
    count: 'Asks how often something happened.',
    lookback: 'Asks what happened in some time window before now.',
    span: 'Asks about a specific date range.',
    absolute: 'Asks what happened at a specific point in time.',
    none: 'No temporal reasoning required.',
  },
} as const

const ENFORCED_DURATION_UNIT_QUESTION = {
  type: 'choice',
  instructions: 'If the question involves a duration, which unit?',
  criteria: {
    days: 'Durations expressed in days.',
    weeks: 'Durations expressed in weeks.',
    months: 'Durations expressed in months.',
    none: 'No duration involved.',
  },
} as const

/** A spec id is always answered or the plane throws; a missing key is a contract violation. */
function enforcedChoiceOrThrow(answers: Map<string, DecisionChoiceAnswer>, id: string): string {
  const answer = answers.get(id)
  if (!answer) {
    throw new Error(`query intent classifier: enforced decision "${id}" returned no answer`)
  }
  return answer.choice
}

/** Back-compat wrapper — prefer classifyQueryIntent for temporal-aware routing. */
export async function classifyRetrievalScopeFromIntent(params: {
  userId: string
  query: string
}): Promise<RetrievalScope> {
  const intent = await classifyQueryIntent(params)
  return intent.scope
}

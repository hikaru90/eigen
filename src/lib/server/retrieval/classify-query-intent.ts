/**
 * Query intent in one step (docs/planning/jev-everywhere-rollout.md, J1): every bounded decision
 * about a question is the decision model's (Jev, ONE Decisions call, six questions); the chat model
 * only extracts what is new text — the entity hints copied from the question and the time window.
 * Nothing falls back: a failing Jev call or chat extraction rejects the query, and the chat reply
 * is never read for a decision.
 *
 * The extraction and the decisions are independent of each other (both read only the question), so
 * they run together.
 */

import { parseOptionalIsoTimestampOrNull } from '$lib/server/datetime/parse-iso'
import type { DecisionChoiceAnswer, DecisionChoiceQuestion } from '$lib/server/llm/decision-client'
import { runEnforcedBoundedDecisions } from '$lib/server/llm/decision-plane'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'

export type RetrievalScope = 'global' | 'local'

export type TemporalQuestionKind =
  'ordering' | 'multi_ordering' | 'duration' | 'count' | 'lookback' | 'span' | 'absolute' | 'none'

export type DurationUnit = 'days' | 'weeks' | 'months'

export type QueryIntent = {
  scope: RetrievalScope
  temporal: boolean
  kind: TemporalQuestionKind
  entityHints: string[]
  timeWindow: { start: Date; end: Date } | null
  /** Output unit for duration/lookback questions (Jev; `none` → null). */
  durationUnit: DurationUnit | null
  /** True when the question compares which of two+ named alternatives came first (A or B). */
  comparativeOrdering: boolean
  /**
   * True when a good answer depends on who the user is (preferences, health, habits, constraints,
   * circumstances) rather than on one stored fact — triggers retrieval query expansion.
   */
  personalization: boolean
}

/** What the chat model returns: new text only (hints copied from the question, an ISO window). */
export type QueryExtraction = {
  entityHints: string[]
  timeWindow: { start: Date; end: Date } | null
}

export const QUERY_EXTRACTION_PROMPT = [
  'You extract the named things and the time window from a question for a personal memory assistant. Return JSON only — no markdown fences.',
  '',
  'Return exactly one object: {"entityHints":string[]} plus the optional keys "timeWindowStart" and "timeWindowEnd".',
  '',
  'entityHints — Verbatim product/entity/event names copied from the question in the same language (quoted names, "X or Y" / "X oder Y" alternatives, "before …" / "nach …" anchors). When the question compares, orders or measures time between several named events, include every endpoint: both ends of an interval, all events to be ordered, and the anchor event of a "before …" question. Empty array if none.',
  'timeWindowStart/timeWindowEnd — Optional ISO-8601 UTC strings when the question implies a calendar window. Leave both keys out entirely when unknown; never use placeholder text.',
  '',
  'Questions may be in any language. Copy hints from the question; do not translate or invent them.',
  '',
  'English examples:',
  '- "How many days had passed between the \'Walk for Hunger\' event and the \'Coastal Cleanup\' event?" → entityHints ["Walk for Hunger","Coastal Cleanup"].',
  '- "How long have I been working before I started my current job at NovaTech?" → entityHints ["working professionally","NovaTech"].',
  '- "How many months ago did I book the Airbnb in San Francisco?" → entityHints ["Airbnb in San Francisco"].',
  '- "Which book did I finish reading first, \'The Hate U Give\' or \'The Nightingale\'?" → entityHints ["The Hate U Give","The Nightingale"].',
  '- "How many days did it take for me to find a house I loved after starting to work with Rachel?" → entityHints ["starting to work with Rachel","find a house I loved"].',
  '- "Which task did I complete first, fixing the fence or trimming the goats\' hooves?" → entityHints ["fixing the fence","trimming the goats\' hooves"].',
  '- "What is the name of my dentist?" → entityHints [].',
  'German examples:',
  '- "Welches Gerät habe ich zuerst bekommen, das Samsung Galaxy S22 oder den Dell XPS 13?" → entityHints ["Samsung Galaxy S22","Dell XPS 13"].',
  '- "Welches Fahrzeug habe ich im Februar zuerst gewartet, das Fahrrad oder das Auto?" → entityHints ["Fahrrad","Auto"].',
  '- "Wie viele Tage lagen zwischen dem Workshop über effektive Kommunikation und dem Team-Meeting?" → entityHints include both event names.',
].join('\n')

export function parseQueryExtractionResponse(text: string): QueryExtraction {
  const parsed = parseLlmJsonPayload(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('query extraction: response is not a JSON object')
  }
  const obj = parsed as Record<string, unknown>
  const rawHints = obj.entityHints
  if (!Array.isArray(rawHints)) {
    throw new Error('query extraction: entityHints must be an array')
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
  return { entityHints, timeWindow }
}

// The six closed-set questions Jev answers for every question. Criteria keys double as the validity
// catalog — runEnforcedBoundedDecisions throws on an off-catalog choice.
const SCOPE_QUESTION: DecisionChoiceQuestion = {
  type: 'choice',
  instructions:
    "Should this question be answered from the user's entire memory, or narrowly from the current conversational context?",
  criteria: {
    global: "The answer may draw on the user's whole stored memory.",
    local: 'The answer should come only from the immediate conversation context.',
  },
}

const TEMPORAL_KIND_QUESTION: DecisionChoiceQuestion = {
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
}

const DURATION_UNIT_QUESTION: DecisionChoiceQuestion = {
  type: 'choice',
  instructions: 'If the question involves a duration, which unit?',
  criteria: {
    days: 'Durations expressed in days.',
    weeks: 'Durations expressed in weeks.',
    months: 'Durations expressed in months.',
    none: 'No duration involved.',
  },
}

const TEMPORAL_QUESTION: DecisionChoiceQuestion = {
  type: 'choice',
  instructions:
    'Does answering this question require reasoning about dates or about the order of events in time?',
  criteria: {
    yes: 'Answering requires comparing dates, ordering events in time, counting days, weeks or months between events, or working out when something happened relative to another event.',
    no: 'No timeline comparison or date arithmetic is needed to answer.',
  },
}

const COMPARATIVE_ORDERING_QUESTION: DecisionChoiceQuestion = {
  type: 'choice',
  instructions: 'Does this question ask which of two or more named alternatives came first?',
  criteria: {
    yes: 'The question asks which of two or more named alternatives (items, events, purchases, trips) came first or happened earlier, for example "bike or car", "Fahrrad oder Auto", "Samsung or Dell".',
    no: 'The question does not compare named alternatives by time: for example "what was the first issue after …" / "was war das erste Problem nach …" (a fact lookup after an anchor), a duration, a count, or any other question.',
  },
}

const PERSONALIZATION_QUESTION: DecisionChoiceQuestion = {
  type: 'choice',
  instructions: 'Does a good answer to this question depend on who the user is?',
  criteria: {
    yes: 'A good answer depends on who the user is (their preferences, health, habits, constraints, circumstances, past experiences) rather than on one stored fact: advice, recommendations, suggestions, "what should I …", "which would suit me", help choosing or planning something for themselves.',
    no: "The answer is a fact lookup, a recall of a specific event or detail, a timeline question, general knowledge, or about a third party, and does not depend on the user's own profile.",
  },
}

const INTENT_SPECS = [
  { decisionKind: 'retrieval_scope', id: 'scope', question: SCOPE_QUESTION },
  { decisionKind: 'query_temporal_kind', id: 'temporal_kind', question: TEMPORAL_KIND_QUESTION },
  { decisionKind: 'duration_unit', id: 'duration_unit', question: DURATION_UNIT_QUESTION },
  { decisionKind: 'query_temporal', id: 'temporal', question: TEMPORAL_QUESTION },
  {
    decisionKind: 'comparative_ordering',
    id: 'comparative_ordering',
    question: COMPARATIVE_ORDERING_QUESTION,
  },
  { decisionKind: 'query_personalization', id: 'personalization', question: PERSONALIZATION_QUESTION },
] as const

/** A spec id is always answered or the plane throws; a missing key is a contract violation. */
function answerOrThrow(answers: Map<string, DecisionChoiceAnswer>, id: string): string {
  const answer = answers.get(id)
  if (!answer) {
    throw new Error(`query intent classifier: enforced decision "${id}" returned no answer`)
  }
  return answer.choice
}

function yesNoOrThrow(answers: Map<string, DecisionChoiceAnswer>, id: string): boolean {
  const choice = answerOrThrow(answers, id)
  if (choice === 'yes') return true
  if (choice === 'no') return false
  throw new Error(`query intent classifier: "${id}" answered "${choice}", expected yes or no`)
}

async function extractQuery(userId: string, query: string): Promise<QueryExtraction> {
  const messages: ChatMessage[] = [
    { role: 'system', content: QUERY_EXTRACTION_PROMPT },
    { role: 'user', content: query },
  ]
  const raw = await llmChatCompletion({
    userId,
    messages,
    temperature: 0,
    responseFormat: 'json_object',
    logContext: 'query_intent_classifier',
  })
  return evictOnReject(raw, () => {
    const content =
      (
        raw as { choices?: Array<{ message?: { content?: string } }> }
      )?.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) {
      throw new Error('query intent classifier: empty LLM response')
    }
    return parseQueryExtractionResponse(content)
  })
}

export async function classifyQueryIntent(params: {
  userId: string
  query: string
}): Promise<QueryIntent> {
  const query = params.query.trim()
  if (!query) {
    throw new Error('classifyQueryIntent: query must be non-empty')
  }

  // No try/catch anywhere: retrieval is critical path, a failed decision or extraction rejects the
  // query (same posture as an LLM gateway outage). Rows record no chat comparison — the chat model
  // answers none of these questions.
  const [extraction, answers] = await Promise.all([
    extractQuery(params.userId, query),
    runEnforcedBoundedDecisions({
      userId: params.userId,
      surface: 'qa_intent',
      state: query,
      specs: INTENT_SPECS.map((spec) => ({ ...spec, llmChoice: null, llmConfidence: null })),
    }),
  ])

  // The plane validated every choice against the criteria catalogs above (off-catalog throws), so
  // these narrows are total.
  const unitChoice = answerOrThrow(answers, 'duration_unit')
  return {
    scope: answerOrThrow(answers, 'scope') as RetrievalScope,
    temporal: yesNoOrThrow(answers, 'temporal'),
    kind: answerOrThrow(answers, 'temporal_kind') as TemporalQuestionKind,
    entityHints: extraction.entityHints,
    timeWindow: extraction.timeWindow,
    durationUnit: unitChoice === 'none' ? null : (unitChoice as DurationUnit),
    comparativeOrdering: yesNoOrThrow(answers, 'comparative_ordering'),
    personalization: yesNoOrThrow(answers, 'personalization'),
  }
}

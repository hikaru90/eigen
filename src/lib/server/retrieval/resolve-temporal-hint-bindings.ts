/**
 * LLM judge: bind classifier entity hints to temporal_event candidates.
 *
 * XXX REMOVED — substring/word-overlap hint matching in temporal-solver and temporal.ts.
 * See `.cursor/rules/no-string-heuristics.mdc`.
 */

import type { TemporalEventKind } from '$lib/server/db/brain.schema'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import type { TemporalQuestionKind } from '$lib/server/retrieval/classify-query-intent'

export type TemporalHintBindingCandidate = {
  eventId: string
  thoughtId: string
  semanticSummary: string
  startAt: string | null
  kind: TemporalEventKind
}

export type TemporalHintBinding = {
  hint: string
  eventId: string
  thoughtId: string
}

/** Prefer milestone-class rows over inferred/planning rows from the same thought. */
const BINDING_KIND_PRIORITY: Record<TemporalEventKind, number> = {
  milestone: 0,
  appointment: 1,
  deadline: 2,
  period: 3,
  reminder: 4,
  inferred_event: 5,
}

const MULTI_ANCHOR_KINDS: TemporalQuestionKind[] = [
  'ordering',
  'duration',
  'span',
  'multi_ordering',
]

export function filterBindingCandidatesForKind(
  candidates: TemporalHintBindingCandidate[],
  kind: TemporalQuestionKind,
): TemporalHintBindingCandidate[] {
  if (MULTI_ANCHOR_KINDS.includes(kind)) {
    return candidates.filter((c) => c.kind !== 'inferred_event')
  }
  if (kind === 'lookback') {
    return candidates.filter((c) => c.kind !== 'deadline' && c.kind !== 'reminder')
  }
  return candidates
}

export function prepareBindingCandidates(
  candidates: TemporalHintBindingCandidate[],
  kind: TemporalQuestionKind,
): TemporalHintBindingCandidate[] {
  return pruneTemporalBindingCandidates(filterBindingCandidatesForKind(candidates, kind))
}

export const RESOLVE_TEMPORAL_HINT_BINDINGS_PROMPT = [
  'You match entity hints from a temporal question to temporal_event candidates from the user memory ledger.',
  'Return JSON only — no markdown fences.',
  '',
  'Return exactly: {"bindings":[{"hint":string,"eventId":string,"thoughtId":string}|null]}',
  '',
  'The bindings array length MUST equal the number of hints listed in the user message — not every entity named in the question.',
  'When only one hint is listed, return exactly one binding (or null).',
  'For each hint in the order given, pick exactly one candidate that refers to the same entity, event, or fact — or null if none match.',
  'Use semantic meaning in any language. Do not rely on literal string overlap.',
  'eventId and thoughtId must come from the candidate list. Do not invent ids.',
  'Do not assign the same event to two hints unless they truly refer to the same event.',
  'When multiple candidates refer to the same product or entity, prefer possession/acquisition/completion over pre-order or planning.',
  '',
  'Kind-specific rules (when question kind is provided):',
  '- ordering — bind acquisition/possession/completion milestones; never pre-order or planning when a later acquisition milestone exists for the same product.',
  '- duration — bind the two named endpoints from the question, not loosely related events.',
  '- span — bind interval endpoints (e.g. career start and job start), not tenure-at-job duration phrases.',
  '- lookback — bind the action milestone (booked, purchased, finished), not payment deadlines or reminders.',
  '- count — bind only the anchor event named in the question.',
].join('\n')

function extractBindingsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const bindings = (parsed as Record<string, unknown>).bindings
    if (Array.isArray(bindings)) return bindings
  }
  throw new Error('temporal hint bindings: bindings must be an array')
}

/** Truncate, pad, or recover when the model returns the wrong number of binding slots. */
export function alignBindingsToHints(rawBindings: unknown[], hintCount: number): unknown[] {
  if (hintCount === 0) return []
  if (rawBindings.length === hintCount) return rawBindings

  if (rawBindings.length > hintCount) {
    if (hintCount === 1) {
      const firstObject = rawBindings.find((entry) => entry !== null && typeof entry === 'object')
      return [firstObject ?? null]
    }
    return rawBindings.slice(0, hintCount)
  }

  return [...rawBindings, ...Array.from({ length: hintCount - rawBindings.length }, () => null)]
}

export function pruneTemporalBindingCandidates(
  candidates: TemporalHintBindingCandidate[],
): TemporalHintBindingCandidate[] {
  const byThoughtId = new Map<string, TemporalHintBindingCandidate[]>()
  for (const candidate of candidates) {
    const group = byThoughtId.get(candidate.thoughtId) ?? []
    group.push(candidate)
    byThoughtId.set(candidate.thoughtId, group)
  }

  const pruned: TemporalHintBindingCandidate[] = []
  for (const group of byThoughtId.values()) {
    if (group.length === 1) {
      pruned.push(group[0]!)
      continue
    }
    const sorted = [...group].sort(
      (a, b) => BINDING_KIND_PRIORITY[a.kind] - BINDING_KIND_PRIORITY[b.kind],
    )
    const bestPriority = BINDING_KIND_PRIORITY[sorted[0]!.kind]
    const best = sorted.filter((c) => BINDING_KIND_PRIORITY[c.kind] === bestPriority)
    pruned.push(...best)
  }

  return pruned
}

export function parseTemporalHintBindingsResponse(
  text: string,
  hints: string[],
  candidates: TemporalHintBindingCandidate[],
): TemporalHintBinding[] {
  const parsed = parseLlmJsonPayload(text)
  if (!parsed || (typeof parsed !== 'object' && !Array.isArray(parsed))) {
    throw new Error('temporal hint bindings: response is not a JSON object')
  }
  const rawBindings = alignBindingsToHints(extractBindingsArray(parsed), hints.length)

  const byEventId = new Map(candidates.map((c) => [c.eventId, c]))
  const byThoughtId = new Map(candidates.map((c) => [c.thoughtId, c]))
  const resolved: TemporalHintBinding[] = []

  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i]!.trim()
    const entry = rawBindings[i]
    if (entry === null) continue
    if (!entry || typeof entry !== 'object') {
      throw new Error('temporal hint bindings: each binding must be an object or null')
    }
    const obj = entry as Record<string, unknown>
    const eventId = typeof obj.eventId === 'string' ? obj.eventId.trim() : ''
    const thoughtId = typeof obj.thoughtId === 'string' ? obj.thoughtId.trim() : ''
    if (!eventId || !thoughtId) continue

    const candidate = byEventId.get(eventId) ?? byThoughtId.get(thoughtId)
    if (!candidate) {
      throw new Error('temporal hint bindings: binding references unknown candidate')
    }
    if (candidate.eventId !== eventId || candidate.thoughtId !== thoughtId) {
      throw new Error(
        'temporal hint bindings: eventId and thoughtId must refer to the same candidate',
      )
    }

    resolved.push({ hint, eventId: candidate.eventId, thoughtId: candidate.thoughtId })
  }

  return resolved
}

function kindBindingRules(kind: TemporalQuestionKind): string {
  switch (kind) {
    case 'ordering':
      return 'Question kind: ordering — pick acquisition/completion milestones; avoid pre-order or planning candidates when an acquisition exists for the same product.'
    case 'duration':
      return 'Question kind: duration — bind the two named endpoints from the question only; each hint maps to the event it names in the question.'
    case 'span':
      return 'Question kind: span — bind the two interval endpoints (start milestone and end milestone), not tenure-duration phrases. For a company hint, pick the job-start milestone, not how long you have worked there.'
    case 'lookback':
      return 'Question kind: lookback — bind the action milestone (booked, purchased, finished), not deadlines or reminders.'
    case 'count':
      return 'Question kind: count — bind only the named anchor event.'
    case 'multi_ordering':
      return 'Question kind: multi_ordering — bind each named event to its best matching candidate.'
    default:
      return ''
  }
}

async function callBindingLlm(params: {
  userId: string
  question: string
  kind: TemporalQuestionKind
  hints: string[]
  candidates: TemporalHintBindingCandidate[]
}): Promise<TemporalHintBinding[]> {
  const kindRules = kindBindingRules(params.kind)
  const candidateBlock = params.candidates
    .map(
      (c) =>
        `- eventId=${c.eventId} thoughtId=${c.thoughtId} kind=${c.kind} startAt=${c.startAt ?? 'unknown'} summary=${JSON.stringify(c.semanticSummary)}`,
    )
    .join('\n')

  const userParts = [
    `Question (context only): ${params.question.trim()}`,
    kindRules,
    params.hints.length === 1
      ? `Bind ONLY this single hint — return a bindings array with exactly 1 element:\n1. ${params.hints[0]}`
      : `Hints (in order — return exactly ${params.hints.length} bindings):\n${params.hints.map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
    `Candidates:\n${candidateBlock}`,
  ].filter((part) => part.length > 0)

  const messages: ChatMessage[] = [
    { role: 'system', content: RESOLVE_TEMPORAL_HINT_BINDINGS_PROMPT },
    { role: 'user', content: userParts.join('\n\n') },
  ]

  const raw = await llmChatCompletion({
    userId: params.userId,
    messages,
    temperature: 0,
    logContext: 'temporal_hint_bindings',
  })

  const content =
    (
      raw as { choices?: Array<{ message?: { content?: string } }> }
    )?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) {
    throw new Error('temporal hint bindings: empty LLM response')
  }

  return parseTemporalHintBindingsResponse(content, params.hints, params.candidates)
}

async function resolvePerHintBindings(params: {
  userId: string
  question: string
  kind: TemporalQuestionKind
  hints: string[]
  candidatesByHint: TemporalHintBindingCandidate[][]
}): Promise<TemporalHintBinding[]> {
  const bindings: TemporalHintBinding[] = []
  const usedEventIds = new Set<string>()

  for (let i = 0; i < params.hints.length; i++) {
    const hint = params.hints[i]!.trim()
    const hintPool = params.candidatesByHint[i] ?? []
    const pool = prepareBindingCandidates(
      hintPool.filter((c) => !usedEventIds.has(c.eventId)),
      params.kind,
    )
    if (pool.length === 0) continue

    const resolved = await callBindingLlm({
      userId: params.userId,
      question: params.question,
      kind: params.kind,
      hints: [hint],
      candidates: pool,
    })
    const binding = resolved[0]
    if (!binding) continue
    bindings.push(binding)
    usedEventIds.add(binding.eventId)
  }

  return bindings
}

export async function resolveTemporalHintBindings(params: {
  userId: string
  question: string
  kind: TemporalQuestionKind
  hints: string[]
  candidates: TemporalHintBindingCandidate[]
  candidatesByHint?: TemporalHintBindingCandidate[][]
}): Promise<TemporalHintBinding[]> {
  const hints = params.hints.map((h) => h.trim()).filter((h) => h.length > 0)
  if (hints.length === 0) return []

  if (
    MULTI_ANCHOR_KINDS.includes(params.kind) &&
    params.candidatesByHint &&
    params.candidatesByHint.length === hints.length
  ) {
    return resolvePerHintBindings({
      userId: params.userId,
      question: params.question,
      kind: params.kind,
      hints,
      candidatesByHint: params.candidatesByHint,
    })
  }

  const prunedCandidates = prepareBindingCandidates(params.candidates, params.kind)
  if (prunedCandidates.length === 0) return []

  return callBindingLlm({
    userId: params.userId,
    question: params.question,
    kind: params.kind,
    hints,
    candidates: prunedCandidates,
  })
}

export function candidatesFromTemporalSeeds(
  seeds: Array<{
    eventId: string
    thoughtId: string
    semanticSummary: string
    startAt: Date | null
    kind: TemporalEventKind
  }>,
): TemporalHintBindingCandidate[] {
  return seeds.map((seed) => ({
    eventId: seed.eventId,
    thoughtId: seed.thoughtId,
    semanticSummary: seed.semanticSummary,
    startAt:
      seed.startAt && !Number.isNaN(seed.startAt.getTime()) ? seed.startAt.toISOString() : null,
    kind: seed.kind,
  }))
}

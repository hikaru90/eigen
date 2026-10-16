/**
 * LLM judge: bind a delete request to one or more retrieve candidates (or none).
 */

import { STRONG_RETRIEVE_MATCH_MIN } from '$lib/server/llm/agent-tool-result-compact'
import { resolveDecisionEnforceKinds } from '$lib/server/llm/decision-client'
import { runEnforcedPerItemDecisions } from '$lib/server/llm/decision-plane'
import { llmChatCompletion, type ChatMessage } from '$lib/server/llm/llm-client'
import { parseLlmJsonPayload } from '$lib/server/memory/llm-json-content'
import { normalizeRetrievalScore } from '$lib/server/retrieval/rrf-scoring'

export type DeleteTargetCandidate = {
  thoughtId: string
  snippet: string
  category?: string
  scoreNormalized: number
}

export const RESOLVE_DELETE_TARGET_PROMPT = [
  'You match a delete request to stored thought candidates from retrieval results.',
  'Return JSON only — no markdown fences.',
  '',
  'Return exactly: {"thoughtIds":["<uuid>", ...]}',
  'Use an empty array when no candidate matches.',
  '',
  'Include every candidate that clearly matches what the user wants removed — same topic, entity, or fact.',
  'Return one id when the user targets a single thought.',
  'Return multiple ids when the user clearly wants several matching thoughts removed (e.g. "delete all recipe notes", "remove the salmon and chicken recipes", "delete my recipes").',
  'When the delete request names a category or type (e.g. "recipe", "recipes", "tasks"), include every candidate in that category from the list.',
  'Recipe candidates may be stored as dish names, ingredients, or instructions without the word "recipe" (e.g. shakshuka, caesar salad, chicken noodle soup). Include them when the delete request targets recipes.',
  'When the request is broad but clearly targets a subset of the candidates, include all semantically matching candidates — not just the highest-scored one.',
  'Use semantic meaning in any language. Do not rely on literal string overlap alone.',
  'Every thoughtId must come from the candidate list. Do not invent ids.',
  'Do not include candidates that do not match the delete request.',
].join('\n')

const MAX_DELETE_CANDIDATES = 40
const SNIPPET_MAX = 200

/**
 * Deterministic delete gate (delete_target enforced): a candidate the decision
 * model selected for deletion must carry at least this probability(delete) —
 * otherwise the whole request is rejected as ambiguous and NOTHING deletes.
 */
const DELETE_TARGET_MIN_CONFIDENCE = 0.8

const DELETE_GATE_CRITERIA = {
  delete: 'This thought matches the delete request — the user means this one.',
  keep: 'This thought does not match the request.',
}

function snippet(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= SNIPPET_MAX) return trimmed
  return `${trimmed.slice(0, SNIPPET_MAX - 3)}...`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function buildDeleteTargetCandidates(results: unknown[]): DeleteTargetCandidate[] {
  if (!Array.isArray(results)) return []

  const candidates: DeleteTargetCandidate[] = []
  for (const row of results.slice(0, MAX_DELETE_CANDIDATES)) {
    const r = asRecord(row)
    if (!r || typeof r.id !== 'string') continue
    const score = typeof r.score === 'number' ? r.score : 0
    const text =
      typeof r.normalizedText === 'string'
        ? r.normalizedText
        : typeof r.rawText === 'string'
          ? r.rawText
          : typeof r.snippet === 'string'
            ? r.snippet
            : ''
    candidates.push({
      thoughtId: r.id,
      snippet: snippet(text),
      category: typeof r.category === 'string' ? r.category : undefined,
      scoreNormalized: normalizeRetrievalScore(score),
    })
  }
  return candidates
}

export function strongDeleteTargetCandidates(
  candidates: DeleteTargetCandidate[],
): DeleteTargetCandidate[] {
  return candidates.filter((c) => c.scoreNormalized >= STRONG_RETRIEVE_MATCH_MIN)
}

function readThoughtIdsFromParsed(parsed: Record<string, unknown>): unknown[] {
  if (Array.isArray(parsed.thoughtIds)) return parsed.thoughtIds
  const legacy = parsed.thoughtId
  if (legacy === null) return []
  if (typeof legacy === 'string' && legacy.trim()) return [legacy]
  return []
}

export function parseDeleteTargetsResponse(
  text: string,
  candidates: DeleteTargetCandidate[],
): DeleteTargetCandidate[] {
  const parsed = parseLlmJsonPayload(text)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('delete target resolver: response is not a JSON object')
  }

  const rawIds = readThoughtIdsFromParsed(parsed as Record<string, unknown>)
  const matches: DeleteTargetCandidate[] = []
  const seen = new Set<string>()

  for (const rawId of rawIds) {
    if (typeof rawId !== 'string' || !rawId.trim()) {
      throw new Error('delete target resolver: thoughtIds must contain non-empty strings')
    }
    const match = candidates.find((c) => c.thoughtId === rawId.trim())
    if (!match) {
      throw new Error('delete target resolver: thoughtIds must reference listed candidates')
    }
    if (!seen.has(match.thoughtId)) {
      seen.add(match.thoughtId)
      matches.push(match)
    }
  }

  return matches
}

export async function resolveDeleteTargets(params: {
  userId: string
  deleteRequest: string
  candidates: DeleteTargetCandidate[]
}): Promise<DeleteTargetCandidate[]> {
  const request = params.deleteRequest.trim()
  if (!request) {
    throw new Error('resolveDeleteTargets: deleteRequest must be non-empty')
  }
  if (params.candidates.length === 0) return []

  // Decision-model authoritative delete targeting (DECISION_ENFORCE_KINDS): one
  // per-candidate question, the decision model's answer replaces the chat
  // judge. No fallback — a failure of the enforced call propagates to the
  // requester as an explicit error.
  if (resolveDecisionEnforceKinds().has('delete_target')) {
    const answers = await runEnforcedPerItemDecisions({
      userId: params.userId,
      surface: 'delete_gate',
      kind: 'delete_target',
      state: request,
      criteria: DELETE_GATE_CRITERIA,
      items: params.candidates.map((c, i) => ({
        ref: `d${i + 1}`,
        instructions: `Should this stored thought be deleted for this request: "${snippet(c.snippet)}"?`,
        llmChoice: null,
      })),
    })

    const selected: DeleteTargetCandidate[] = []
    let bestConfidence = 0
    for (let i = 0; i < params.candidates.length; i++) {
      const answer = answers.get(`d${i + 1}`)
      if (!answer || answer.choice !== 'delete') continue
      selected.push(params.candidates[i])
      if (answer.probability > bestConfidence) bestConfidence = answer.probability
    }

    // Deterministic gate, checked on the answers BEFORE anything is returned:
    // an ambiguous request deletes nothing.
    for (let i = 0; i < params.candidates.length; i++) {
      const answer = answers.get(`d${i + 1}`)
      if (answer && answer.choice === 'delete' && answer.probability < DELETE_TARGET_MIN_CONFIDENCE) {
        throw new Error(
          `[delete-gate] ambiguous delete request — refine it (best match confidence ${bestConfidence.toFixed(2)})`,
        )
      }
    }

    return selected
  }

  const candidateBlock = params.candidates
    .map(
      (c) =>
        `- thoughtId=${c.thoughtId} score=${c.scoreNormalized.toFixed(2)} category=${c.category ?? 'unknown'} snippet=${JSON.stringify(c.snippet)}`,
    )
    .join('\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: RESOLVE_DELETE_TARGET_PROMPT },
    {
      role: 'user',
      content: `Delete request: ${request}\n\nCandidates:\n${candidateBlock}`,
    },
  ]

  const raw = await llmChatCompletion({
    userId: params.userId,
    messages,
    temperature: 0,
    logContext: 'delete_target_resolver',
  })

  const content =
    (
      raw as { choices?: Array<{ message?: { content?: string } }> }
    )?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) {
    throw new Error('delete target resolver: empty LLM response')
  }

  return parseDeleteTargetsResponse(content, params.candidates)
}

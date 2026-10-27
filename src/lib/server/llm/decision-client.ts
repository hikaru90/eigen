/**
 * Decision-model client (OpenRouter Decisions API, e.g. typesafe/jev-1.13).
 *
 * Decision models produce bounded, typed answers with calibrated probabilities —
 * a drop-in *implementation* of the "LLM as judge (no string heuristics)" policy
 * for bounded classifications. Never a string heuristic: always a model call.
 *
 * API contract (openrouter.ai/docs/api/api-reference/alphadecisions):
 * POST https://openrouter.ai/api/alpha/decisions
 * Authorization: Bearer <OPENROUTER_API_KEY>
 * body:   { model, state, questions: { [id]: { type: 'choice', instructions, criteria } } }
 * result: { model, answers: { [id]: { type: 'choice', choice, probabilities, confidence } },
 *           usage: { cost, input_tokens, output_tokens }, id?, provider? }
 */

import { resolveTenantUserId } from '$lib/server/billing/context'
import { env } from '$lib/server/env/private-env'
import { currentEvalLlmCache, evalLlmCacheFor } from '$lib/server/llm/eval-llm-cache'
import { extractGatewayReportedCostUsd } from '$lib/server/llm/gateway-cost'

const DECISIONS_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'
const DEFAULT_DECISION_TIMEOUT_MS = 10_000

export type DecisionShadowConfig = {
  apiKey: string
  model: string
}

/**
 * Bounded decision kinds the decision plane compares (spec §3). Widened with
 * resolution_choice, delete_target, message_intent, open_loop, and
 * salience_band for the upcoming resolution / delete-gate / chat-turn
 * surfaces. `capture_audit` is Jev-only (the capture review's check of what
 * the chat model wrote, docs/planning/capture-feedback.md §4): it has no
 * chat-judge counterpart, so it is NOT an enforceable kind.
 */
export type DecisionKind =
  | 'category'
  | 'content_role'
  | 'entity_type'
  | 'relation_type'
  | 'temporal_kind'
  | 'retrieval_scope'
  | 'query_temporal_kind'
  | 'duration_unit'
  | 'gtd_promotion'
  | 'resolution_choice'
  | 'delete_target'
  | 'message_intent'
  | 'open_loop'
  | 'salience_band'
  | 'capture_audit'

/**
 * Kinds with an implemented promotion path (spec §6 P). entity_type,
 * relation_type, and temporal_kind are per-item enforced: one question per
 * mention/pair, one Decisions call (spec §8 O1). retrieval_scope,
 * query_temporal_kind, duration_unit, and gtd_promotion are whole-question
 * kinds enforced on the chat/qa surfaces (spec §5.2) via
 * runEnforcedBoundedDecisions. resolution_choice, delete_target,
 * message_intent, open_loop, and salience_band widen the accepted registry
 * ahead of their surfaces — they parse and enforce (fail loud) today and
 * gain their question wiring with the resolution / delete-gate / chat-turn
 * surfaces. Config fail-louds rather than silently ignoring an unknown kind.
 */
const ENFORCEABLE_KINDS = [
  'category',
  'content_role',
  'entity_type',
  'relation_type',
  'temporal_kind',
  'retrieval_scope',
  'query_temporal_kind',
  'duration_unit',
  'gtd_promotion',
  'resolution_choice',
  'delete_target',
  'message_intent',
  'open_loop',
  'salience_band',
] as const

export type EnforceableDecisionKind = (typeof ENFORCEABLE_KINDS)[number]

/**
 * Resolves which decision kinds are decision-model authoritative
 * (DECISION_ENFORCE_KINDS, e.g. "category,content_role").
 * Absent/blank = none enforced (deterministic, documented state).
 * Unknown kinds throw — fail loud, never a silent no-op (spec P5: no silent
 * cutover).
 */
export function resolveDecisionEnforceKinds(
  source: Record<string, string | undefined> = env,
): ReadonlySet<EnforceableDecisionKind> {
  const raw = source.DECISION_ENFORCE_KINDS?.trim() ?? ''
  if (!raw) return new Set()
  const kinds = new Set<EnforceableDecisionKind>()
  for (const token of raw.split(',')) {
    const kind = token.trim().toLowerCase()
    if (!kind) continue
    if (!ENFORCEABLE_KINDS.includes(kind as EnforceableDecisionKind)) {
      throw new Error(
        `DECISION_ENFORCE_KINDS: unknown decision kind "${kind}" (known: ${ENFORCEABLE_KINDS.join(', ')})`,
      )
    }
    kinds.add(kind as EnforceableDecisionKind)
  }
  return kinds
}

/**
 * Resolves the decision-shadow config from platform env.
 * Returns null when the shadow is disabled (a deterministic, documented state).
 * Throws when DECISION_SHADOW_ENABLED=true but any required var is missing — fail loud.
 * Never returns implicit defaults for required config (no `|| 'localhost'` shapes).
 */
export function resolveDecisionShadowConfig(
  source: Record<string, string | undefined> = env,
): DecisionShadowConfig | null {
  const enabled = source.DECISION_SHADOW_ENABLED?.trim().toLowerCase() === 'true'
  if (!enabled) return null
  const required = {
    OPENROUTER_API_KEY: source.OPENROUTER_API_KEY?.trim(),
    DECISION_SHADOW_MODEL: source.DECISION_SHADOW_MODEL?.trim(),
  }
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length > 0) {
    throw new Error(`DECISION_SHADOW_ENABLED=true but missing env: ${missing.join(', ')}`)
  }
  return {
    apiKey: required.OPENROUTER_API_KEY as string,
    model: required.DECISION_SHADOW_MODEL as string,
  }
}

export type DecisionChoiceQuestion = {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

export type DecisionRequest = {
  state: string
  questions: Record<string, DecisionChoiceQuestion>
}

export type DecisionChoiceAnswer = {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export type DecisionResponse = {
  model: string
  answers: Record<string, DecisionChoiceAnswer>
  usage: { input_tokens: number; output_tokens: number }
  /** Provider-reported billable USD (usage.cost); null when absent — never inferred. */
  reportedCostUsd: number | null
  /** Eval response cache hit: no request was made and nothing was paid (reportedCostUsd is 0). */
  cached?: true
}

/**
 * Errors are built from the HTTP status and the API's error messages only —
 * never from request bodies or the bearer token (secret redaction).
 */
function describeHttpFailure(status: number, bodyText: string): string {
  let apiMessage: string
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: unknown }
      errors?: Array<{ message?: unknown }>
      message?: unknown
    }
    const candidates: string[] = []
    if (typeof parsed.error?.message === 'string') candidates.push(parsed.error.message)
    for (const e of parsed.errors ?? []) {
      if (typeof e?.message === 'string') candidates.push(e.message)
    }
    if (typeof parsed.message === 'string') candidates.push(parsed.message)
    apiMessage = candidates.filter(Boolean).join('; ')
  } catch {
    apiMessage = ''
  }
  return apiMessage
    ? `Decision request failed (${status}): ${apiMessage}`
    : `Decision request failed with HTTP ${status}`
}

function parseProbabilityMap(value: unknown, field: string): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Decision answer field "${field}" must be an object of probabilities`)
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    throw new Error(`Decision answer field "${field}" must not be empty`)
  }
  const out: Record<string, number> = {}
  for (const [key, prob] of entries) {
    if (typeof prob !== 'number' || !Number.isFinite(prob) || prob < 0 || prob > 1) {
      throw new Error(`Decision answer field "${field}" has invalid probability for option "${key}"`)
    }
    out[key] = prob
  }
  return out
}

function parseChoiceAnswer(questionId: string, value: unknown): DecisionChoiceAnswer {
  if (!value || typeof value !== 'object') {
    throw new Error(`Decision answer for question "${questionId}" is missing`)
  }
  const obj = value as Record<string, unknown>
  if (obj.type !== 'choice') {
    throw new Error(`Decision answer for question "${questionId}" has unexpected type "${String(obj.type)}"`)
  }
  if (typeof obj.choice !== 'string' || !obj.choice.trim()) {
    throw new Error(`Decision answer for question "${questionId}" is missing "choice"`)
  }
  const confidence = obj.confidence
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Decision answer for question "${questionId}" has invalid "confidence"`)
  }
  return {
    type: 'choice',
    choice: obj.choice,
    probabilities: parseProbabilityMap(obj.probabilities, `${questionId}.probabilities`),
    confidence,
  }
}

function parseDecisionResponse(questionIds: string[], body: unknown): DecisionResponse {
  const root = body as { model?: unknown; answers?: unknown; usage?: unknown }
  if (!root || typeof root !== 'object' || !root.answers || typeof root.answers !== 'object') {
    throw new Error('Decision response is missing "answers"')
  }
  const answers: Record<string, DecisionChoiceAnswer> = {}
  for (const id of questionIds) {
    answers[id] = parseChoiceAnswer(id, (root.answers as Record<string, unknown>)[id])
  }
  const usage = root.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined
  return {
    model: typeof root.model === 'string' ? root.model : 'unknown',
    answers,
    usage: {
      input_tokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0,
      output_tokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0,
    },
    // usage.cost per the gateway-cost policy: provider-reported only, never inferred.
    reportedCostUsd: extractGatewayReportedCostUsd(root),
  }
}

export async function runDecisionModel(
  config: DecisionShadowConfig,
  request: DecisionRequest,
  opts?: { timeoutMs?: number },
): Promise<DecisionResponse> {
  const body = {
    model: config.model,
    state: request.state,
    questions: request.questions,
  }
  const questionIds = Object.keys(request.questions)
  // eval response cache (harness tenants only): the tenant is the RLS user the eval harness set
  const cache = currentEvalLlmCache() ? evalLlmCacheFor(resolveTenantUserId('')) : undefined
  const cacheRequest = {
    endpoint: 'decisions' as const,
    provider: 'openrouter',
    model: config.model,
    body,
  }
  const hit = cache?.lookup(cacheRequest)
  if (cache !== undefined && hit !== undefined) {
    cache.noteHit('decisions', hit.costUsd)
    return { ...parseDecisionResponse(questionIds, hit.response), reportedCostUsd: 0, cached: true }
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS
  const controller = new AbortController()
  const abortTimer = setTimeout(
    () => controller.abort(new Error(`Decision request timeout after ${timeoutMs}ms`)),
    timeoutMs,
  )

  let res: Response
  try {
    res = await fetch(DECISIONS_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      /timeout/i.test(reason) ? reason : `Decision request failed: ${reason || 'network error'}`,
      { cause: err },
    )
  } finally {
    clearTimeout(abortTimer)
  }

  const bodyText = await res.text()
  if (!res.ok) {
    throw new Error(describeHttpFailure(res.status, bodyText))
  }

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(bodyText)
  } catch {
    throw new Error(`Decision response is not JSON (HTTP ${res.status})`)
  }

  const parsed = parseDecisionResponse(questionIds, parsedBody)
  if (cache !== undefined) {
    // persisted before the answer is used; only a response that parsed is worth keeping
    const costUsd = parsed.reportedCostUsd ?? 0
    cache.store(cacheRequest, { response: parsedBody, costUsd })
    cache.notePaid('decisions', costUsd)
  }
  return parsed
}

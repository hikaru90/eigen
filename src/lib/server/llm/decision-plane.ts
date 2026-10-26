/**
 * Decision-model plane for thought ingest (OpenRouter Decisions API, e.g.
 * typesafe/jev-1.13) — spec: docs/planning/09-jev-decision-plane.md.
 *
 * Two modes per decision kind (spec §6 P — promotion):
 * - Shadow (authoritative_engine='chat_judge'): the chat judge decides; the
 *   decision model runs SIDE BY SIDE and rows are metadata-only diagnostics.
 *   Failures never propagate into capture (AC-S1-4).
 * - Enforced (authoritative_engine='decision_model', DECISION_ENFORCE_KINDS):
 *   the decision model's answer is authoritative. The chat judge's answer —
 *   when one exists — is recorded as the comparison (roles reversed, spec P5).
 *   A failure, timeout, or off-catalog answer for an ENFORCED kind throws
 *   into the ingest retry ladder (fail loud, no fallback). Non-enforced
 *   kinds keep the never-throw guarantee.
 *
 * Question design rule (spec §2): a question is a decision-model question
 * only when the answer is a key from a closed catalog. Free-form extraction
 * stays on the chat judge; embeddings stay on the embedding gateway.
 *
 * Guarantees:
 * - Privacy: rows contain choice keys, probabilities, timings and errors
 *   only — never thought text, thought ids, or bodies.
 * - Cost transparency: exactly ONE activity_call_log row per Decisions API
 *   call with the provider-reported cost attributed once (not per kind).
 */

import { logActivityCall } from '$lib/server/activity/log-call'
import { isContentRole, type ContentRole } from '$lib/server/capture/content-role'
import { getDb } from '$lib/server/db'
import { decisionShadowLog } from '$lib/server/db/schema'
import {
  resolveDecisionEnforceKinds,
  resolveDecisionShadowConfig,
  runDecisionModel,
  type DecisionChoiceAnswer,
  type DecisionChoiceQuestion,
  type DecisionKind,
  type DecisionResponse,
  type DecisionShadowConfig,
  type EnforceableDecisionKind,
} from './decision-client'

export type { DecisionKind }

/**
 * Where the decision call ran. capture_service and enrich_queued are the
 * ingest surfaces; qa_intent, interpret_preview, and gtd_judge are the
 * planned chat/qa surfaces (spec §5.2) served by
 * runEnforcedBoundedDecisions. resolution, delete_gate, and chat_turn widen
 * the surface registry ahead of their flows — rows record the surface
 * verbatim and behavior is unchanged for every existing surface.
 */
export type DecisionShadowSurface =
  | 'capture_service'
  | 'enrich_queued'
  | 'qa_intent'
  | 'interpret_preview'
  | 'gtd_judge'
  | 'resolution'
  | 'delete_gate'
  | 'chat_turn'

export type { ContentRole }

export type DecisionCatalogKind = { key: string; name: string; definition: string }

/** The early content_role decision when the kind is decision-model authoritative. */
export type EnforcedContentRole = {
  role: ContentRole
  probability: number
  /** Probabilities of the non-chosen options. */
  alternatives: Record<string, number>
  /** Wall time of the early Decisions call that produced this answer. */
  durationMs: number
}

/** Enforced decisions returned to the caller at settle time. */
export type EnforcedDecisions = {
  /** Authoritative category answer — the caller validates the key against the ontology. */
  category?: { choice: string; probability: number; alternatives: Record<string, number> }
}

export type DecisionShadowContext = {
  userId: string
  surface: DecisionShadowSurface
  /** Capture text sent as the Decisions API `state` — never persisted. */
  state: string
  /** Active thought_category kinds — enables the `category` question. */
  categoryKinds: DecisionCatalogKind[]
  /** Active entity_type kinds — enables the `entity_type` question when non-empty. */
  entityTypeKinds?: DecisionCatalogKind[]
  /** Enables the `content_role` question (personal | reference | mixed). */
  contentRoleEnabled?: boolean
  /**
   * Present when content_role is ENFORCED and the early pre-split call
   * already decided it — the later call then excludes the question.
   */
  enforcedContentRole?: EnforcedContentRole
}

export type DecisionShadowPrimaries = {
  /** Authoritative category decision — always required. */
  category: { choice: string; confidence: number | null }
  /**
   * Chat content-role decision — absent when the decision model is
   * authoritative (the chat call then only generates for the decided role).
   */
  contentRole?: { choice: ContentRole; confidence?: number | null }
  /** Dominant mention's resolved entity type — recorded only when a mention exists. */
  entityType?: { choice: string; confidence: number | null }
}

/**
 * Picks the dominant entity mention's resolved type: highest confidence,
 * first occurrence on ties (deterministic). Returns null when the bundle
 * extracted no mentions — there is no comparable pair then.
 */
export function dominantEntityType(
  mentions: ReadonlyArray<{ entityType: string; confidence: number }>,
): { choice: string; confidence: number } | null {
  if (mentions.length === 0) return null
  let best = mentions[0]
  for (const m of mentions) {
    if (m.confidence > best.confidence) best = m
  }
  return { choice: best.entityType, confidence: best.confidence }
}

/**
 * Content role (docs/planning/long-text-memory.md, L1–L6). Decided by MEANING, never by length:
 * the ~300-character remark is guidance for the model, not a rule anywhere in code.
 */
const CONTENT_ROLE_CRITERIA: Record<ContentRole, string> = {
  personal:
    "The whole text is the user's own account: their experiences, thoughts, plans, tasks, decisions, feelings, observations, or things people told them. It is stored as the user's own thoughts — one thought for a short entry, one thought per distinct thing (topic, event, task) for a longer one. A long text stays personal when all of it is the user's own account.",
  reference:
    "The text is reference material rather than the user's own account: a recipe, template, procedure, checklist, specification, code, meeting transcript, article or pasted document, or an email or letter written to someone else. It is stored as a short pointer thought plus the full text as a linked note.",
  mixed:
    "The text contains BOTH the user's own words (why they saved it, what it is for, a personal circumstance or plan) AND reference material such as a pasted recipe, document or draft. The personal parts are stored as the user's own thoughts and the reference part as a linked note.",
}

const CATEGORY_INSTRUCTIONS = 'Which ontology thought category best matches this captured thought?'
const CONTENT_ROLE_INSTRUCTIONS =
  "Decide by what the text is, not by how long it is: is the whole captured input the user's own personally relevant account (personal), reference material (reference), or both (mixed)? Length is only a hint: text longer than about 300 characters (longer than a tweet) is more likely to hold several distinct things or a pasted document and deserves a closer look, but a long text that is entirely the user's own account is still personal and a short text can still be reference."
const ENTITY_TYPE_INSTRUCTIONS =
  'Which ontology entity type best matches the dominant entity mentioned in this captured thought?'

function catalogCriteria(kinds: DecisionCatalogKind[]): Record<string, string> {
  return Object.fromEntries(kinds.map((k) => [k.key, `${k.name}: ${k.definition}`.trim()]))
}

/** The bounded questions enabled for this context, in stable order. */
export function decisionQuestionsFor(ctx: DecisionShadowContext): Record<string, DecisionChoiceQuestion> {
  const questions: Record<string, DecisionChoiceQuestion> = {
    category: {
      type: 'choice',
      instructions: CATEGORY_INSTRUCTIONS,
      criteria: catalogCriteria(ctx.categoryKinds),
    },
  }
  // Enforced content_role was already decided by the early pre-split call —
  // asking again would double-charge and could contradict the applied split.
  if (ctx.contentRoleEnabled && !ctx.enforcedContentRole) {
    questions.content_role = {
      type: 'choice',
      instructions: CONTENT_ROLE_INSTRUCTIONS,
      criteria: CONTENT_ROLE_CRITERIA,
    }
  }
  if (ctx.entityTypeKinds && ctx.entityTypeKinds.length > 0) {
    questions.entity_type = {
      type: 'choice',
      instructions: ENTITY_TYPE_INSTRUCTIONS,
      criteria: catalogCriteria(ctx.entityTypeKinds),
    }
  }
  return questions
}

/** Kinds whose rows this context records, in stable order. */
function enabledKinds(ctx: DecisionShadowContext): DecisionKind[] {
  const kinds: DecisionKind[] = ['category']
  if (ctx.contentRoleEnabled || ctx.enforcedContentRole) kinds.push('content_role')
  if (ctx.entityTypeKinds && ctx.entityTypeKinds.length > 0) kinds.push('entity_type')
  return kinds
}

/**
 * entity_type is enforced per mention (runEnforcedPerItemDecisions): the
 * generic dominant-mention question would double-ask and its row would
 * contradict the per-mention rows. When enforced, it disappears from the
 * generic shadow entirely — question and row — while category/content_role
 * keep their behavior.
 */
function genericShadowKinds(
  ctx: DecisionShadowContext,
  enforceKinds: ReadonlySet<EnforceableDecisionKind>,
): DecisionKind[] {
  const kinds = enabledKinds(ctx)
  if (!enforceKinds.has('entity_type')) return kinds
  return kinds.filter((k) => k !== 'entity_type')
}

/** The generic call's questions — the enforced entity_type question removed. */
function genericShadowQuestions(
  ctx: DecisionShadowContext,
  enforceKinds: ReadonlySet<EnforceableDecisionKind>,
): Record<string, DecisionChoiceQuestion> {
  const questions = decisionQuestionsFor(ctx)
  if (!enforceKinds.has('entity_type')) return questions
  const { entity_type: _perMention, ...generic } = questions
  return generic
}

type KindOutcome =
  | {
      ok: true
      choice: string
      probability: number
      alternatives: Record<string, number>
    }
  | { ok: false; error: string }

type InflightOutcome =
  | {
      ok: true
      byKind: Record<string, KindOutcome>
      reportedCostUsd: number | null
      cached: boolean
      durationMs: number
    }
  | { ok: false; error: string; durationMs: number }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Early content_role decision for the ENFORCED path (spec §6 P): one
 * Decisions API call with only the content_role question, kicked before the
 * content_split phase so the pipeline can act on the role (the generation
 * call then runs for the decided role only). Returns null when content_role
 * is not enforced — the caller keeps the shadow-only flow.
 *
 * decide() FAILS LOUD on call errors and off-catalog choices — an enforced
 * decision has no fallback; the enrich retry ladder owns recovery.
 */
export function startContentRoleDecision(input: {
  userId: string
  state: string
}): { decide: () => Promise<EnforcedContentRole> } | null {
  const enforceKinds = resolveDecisionEnforceKinds()
  if (!enforceKinds.has('content_role')) return null

  const startedAt = Date.now()
  const resolved = resolveDecisionShadowConfigSafe()
  if (!resolved) {
    throw new Error(
      '[decision-plane] content_role is enforced (DECISION_ENFORCE_KINDS) but the decision-model config is unavailable (DECISION_SHADOW_ENABLED / OPENROUTER_API_KEY / DECISION_SHADOW_MODEL)',
    )
  }

  const inflight = runDecisionModel(resolved, {
    state: input.state,
    questions: {
      content_role: {
        type: 'choice',
        instructions: CONTENT_ROLE_INSTRUCTIONS,
        criteria: CONTENT_ROLE_CRITERIA,
      },
    },
  })

  return {
    decide: async () => {
      let res
      try {
        res = await inflight
      } catch (err) {
        throw new Error(`[decision-plane] enforced content_role decision failed: ${errorText(err)}`, {
          cause: err,
        })
      }
      const answer = res.answers['content_role']
      if (!isContentRole(answer.choice)) {
        throw new Error(
          `[decision-plane] enforced content_role returned off-catalog choice "${answer.choice}" — no repair, no fallback`,
        )
      }
      const alternatives: Record<string, number> = {}
      for (const [key, prob] of Object.entries(answer.probabilities)) {
        if (key !== answer.choice) alternatives[key] = prob
      }
      // Cost transparency: one activity row for THIS call (the later shadow
      // call attributes its own).
      try {
        await logActivityCall(getDb(), input.userId, {
          provider: 'openrouter',
          operation: 'decision_shadow',
          baseCostUsd: res.reportedCostUsd ?? 0,
          gatewayHost: 'openrouter.ai',
          context: 'decision_shadow kinds=content_role surface=enrich_queued(pre-split)',
          durationMs: Date.now() - startedAt,
          cached: res.cached === true,
        })
      } catch (err) {
        console.error('[decision-plane] failed to record content_role activity row', err)
      }
      return {
        role: answer.choice,
        probability: answer.probabilities[answer.choice],
        alternatives,
        durationMs: Date.now() - startedAt,
      }
    },
  }
}

/**
 * Resolves the shadow config; null when disabled. Never throws (misconfig is
 * handled per surface: loud-but-non-fatal for shadow kinds, fatal when a
 * kind is enforced).
 */
function resolveDecisionShadowConfigSafe(): DecisionShadowConfig | null {
  try {
    return resolveDecisionShadowConfig()
  } catch {
    return null
  }
}

/** Kinds decided per item (mention/pair, delete candidate) rather than for the capture as a whole. */
type PerItemKind = 'entity_type' | 'relation_type' | 'temporal_kind' | 'delete_target'

export type PerItemDecisionItem = {
  /** Deterministic surrogate stored in decision_shadow_log.subject_ref — never text. */
  ref: string
  /** Full question instructions; may quote the item's surface text (goes to the model, not the log). */
  instructions: string
  /** The chat judge's answer for this item — comparison column. Null when the chat call was skipped. */
  llmChoice: string | null
  llmConfidence?: number | null
}

export type PerItemDecisionAnswer = {
  choice: string
  probability: number
  /** Probabilities of the non-chosen options. */
  alternatives: Record<string, number>
}

function perItemRow(
  input: { userId: string; surface: DecisionShadowSurface; kind: PerItemKind },
  item: PerItemDecisionItem,
  answer: PerItemDecisionAnswer | null,
  durationMs: number,
  error: string | null,
): typeof decisionShadowLog.$inferInsert {
  return {
    userId: input.userId,
    surface: input.surface,
    decisionKind: input.kind,
    subjectRef: item.ref,
    llmChoice: item.llmChoice,
    llmConfidence: item.llmConfidence ?? null,
    decisionChoice: answer?.choice ?? null,
    decisionProbability: answer?.probability ?? null,
    decisionAlternatives: answer?.alternatives ?? null,
    agree: item.llmChoice !== null && answer ? item.llmChoice === answer.choice : null,
    decisionError: error,
    decisionDurationMs: durationMs,
    authoritativeEngine: 'decision_model',
  }
}

/**
 * Writes the evidence rows and the call's ONE activity row. A logging failure
 * must never mask the enforced throw below — log loudly and let the caller
 * rethrow the original (same posture as recordRows).
 */
async function persistPerItemRows(
  input: { userId: string; surface: DecisionShadowSurface; kind: PerItemKind },
  items: PerItemDecisionItem[],
  rows: Array<typeof decisionShadowLog.$inferInsert>,
  reportedCostUsd: number | null,
  durationMs: number,
  cached: boolean,
): Promise<void> {
  try {
    if (rows.length > 0) {
      await getDb().insert(decisionShadowLog).values(rows)
    }
    // Cost transparency: exactly one activity row per Decisions call — even
    // on failure, the call happened.
    await logActivityCall(getDb(), input.userId, {
      provider: 'openrouter',
      operation: 'decision_shadow',
      // Provider-reported USD (usage.cost); 0 when absent — never inferred.
      baseCostUsd: reportedCostUsd ?? 0,
      gatewayHost: 'openrouter.ai',
      context: `decision_shadow kinds=${input.kind} items=${items.length} surface=${input.surface}`,
      durationMs,
      cached,
    })
  } catch (err) {
    console.error('[decision-plane] failed to record per-item decision rows', err)
  }
}

/**
 * Per-item ENFORCED decisions (spec §8 O1): ONE Decisions call asking the
 * same bounded question once per mention/pair, keyed `${kind}:${ref}`. The
 * decision model's answer is authoritative and returned per item ref; the
 * chat judge's answer (when one exists) is recorded as the comparison.
 *
 * FAILS LOUD on call errors and off-catalog choices — an enforced decision
 * has no fallback; the enrich retry ladder owns recovery. Evidence is
 * written first: every item gets a row even when the call or one item's
 * answer failed. Rows are privacy-safe by construction: refs, choice keys,
 * probabilities — never instructions text, surfaces, or thought text.
 */
export async function runEnforcedPerItemDecisions(input: {
  userId: string
  surface: DecisionShadowSurface
  kind: PerItemKind
  /** The capture text sent as the Decisions API `state`. */
  state: string
  criteria: Record<string, string>
  items: PerItemDecisionItem[]
}): Promise<Map<string, PerItemDecisionAnswer>> {
  // Nothing to decide — no call, no rows, no activity row.
  if (input.items.length === 0) return new Map()

  const resolved = resolveDecisionShadowConfigSafe()
  if (!resolved) {
    throw new Error(
      `[decision-plane] enforced ${input.kind} per-item decisions require DECISION_SHADOW_ENABLED=true with a complete decision-model config`,
    )
  }

  const startedAt = Date.now()
  const questions: Record<string, DecisionChoiceQuestion> = {}
  for (const item of input.items) {
    questions[`${input.kind}:${item.ref}`] = {
      type: 'choice',
      instructions: item.instructions,
      criteria: input.criteria,
    }
  }

  let res: DecisionResponse
  try {
    res = await runDecisionModel(resolved, { state: input.state, questions })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const rows = input.items.map((item) => perItemRow(input, item, null, durationMs, errorText(err)))
    await persistPerItemRows(input, input.items, rows, null, durationMs, false)
    throw new Error(`[decision-plane] enforced ${input.kind} per-item decision failed: ${errorText(err)}`, {
      cause: err,
    })
  }

  const durationMs = Date.now() - startedAt
  const answers = new Map<string, PerItemDecisionAnswer>()
  const rows: Array<typeof decisionShadowLog.$inferInsert> = []
  let offCatalog: string | null = null
  for (const item of input.items) {
    const answer = res.answers[`${input.kind}:${item.ref}`]
    if (!Object.hasOwn(input.criteria, answer.choice)) {
      // All items get their rows before the throw — the evidence persists.
      offCatalog = `[decision-plane] enforced ${input.kind} item ${item.ref} returned off-catalog choice "${answer.choice}"`
      rows.push(perItemRow(input, item, null, durationMs, offCatalog))
      continue
    }
    const alternatives: Record<string, number> = {}
    for (const [key, prob] of Object.entries(answer.probabilities)) {
      if (key !== answer.choice) alternatives[key] = prob
    }
    const perItem: PerItemDecisionAnswer = {
      choice: answer.choice,
      probability: answer.probabilities[answer.choice],
      alternatives,
    }
    answers.set(item.ref, perItem)
    rows.push(perItemRow(input, item, perItem, durationMs, null))
  }

  await persistPerItemRows(input, input.items, rows, res.reportedCostUsd, durationMs, res.cached === true)

  if (offCatalog) throw new Error(offCatalog)
  return answers
}

/**
 * A whole-question enforced decision: one bounded question for the call as a
 * whole (not per mention/pair) — e.g. retrieval scope or GTD promotion on the
 * chat/qa surfaces (spec §5.2). The id is this call's question key and may
 * carry a surrogate ref ('gtd:hub-3') — never text.
 */
export type BoundedDecisionSpec = {
  /** Row identity: decision_kind column value (e.g. 'retrieval_scope', 'gtd_promotion'). */
  decisionKind: DecisionKind
  /** Unique question id within this call (e.g. 'scope', 'gtd:hub-<index>'). */
  id: string
  question: DecisionChoiceQuestion
  /** Chat judge's answer for the comparison column; null when the chat call was skipped. */
  llmChoice: string | null
  llmConfidence?: number | null
}

function boundedRow(
  input: { userId: string; surface: DecisionShadowSurface },
  spec: BoundedDecisionSpec,
  answer: DecisionChoiceAnswer | null,
  durationMs: number,
  error: string | null,
): typeof decisionShadowLog.$inferInsert {
  const alternatives: Record<string, number> | null = answer
    ? Object.fromEntries(Object.entries(answer.probabilities).filter(([key]) => key !== answer.choice))
    : null
  return {
    userId: input.userId,
    surface: input.surface,
    decisionKind: spec.decisionKind,
    // Whole-question decisions have no per-item subject.
    subjectRef: null,
    llmChoice: spec.llmChoice,
    llmConfidence: spec.llmConfidence ?? null,
    decisionChoice: answer?.choice ?? null,
    decisionProbability: answer ? answer.probabilities[answer.choice] : null,
    decisionAlternatives: alternatives,
    agree: spec.llmChoice !== null && answer ? spec.llmChoice === answer.choice : null,
    decisionError: error,
    decisionDurationMs: durationMs,
    authoritativeEngine: 'decision_model',
  }
}

/**
 * Writes the bounded evidence rows and the call's ONE activity row. A logging
 * failure must never mask the enforced throw below — log loudly and let the
 * caller rethrow the original (same posture as persistPerItemRows).
 */
async function persistBoundedRows(
  input: { userId: string; surface: DecisionShadowSurface },
  specs: BoundedDecisionSpec[],
  rows: Array<typeof decisionShadowLog.$inferInsert>,
  reportedCostUsd: number | null,
  durationMs: number,
  cached: boolean,
): Promise<void> {
  try {
    if (rows.length > 0) {
      await getDb().insert(decisionShadowLog).values(rows)
    }
    // Cost transparency: exactly one activity row per Decisions call — even
    // on failure, the call happened.
    await logActivityCall(getDb(), input.userId, {
      provider: 'openrouter',
      operation: 'decision_shadow',
      // Provider-reported USD (usage.cost); 0 when absent — never inferred.
      baseCostUsd: reportedCostUsd ?? 0,
      gatewayHost: 'openrouter.ai',
      context: `decision_shadow kinds=${specs.map((s) => s.decisionKind).join(',')} surface=${input.surface}`,
      durationMs,
      cached,
    })
  } catch (err) {
    console.error('[decision-plane] failed to record bounded decision rows', err)
  }
}

/**
 * Whole-question ENFORCED decisions (spec §5.2 chat/qa surfaces): ONE
 * Decisions call asking each bounded spec's question once, keyed by spec id.
 * The decision model's answer is authoritative and returned per spec id; the
 * chat judge's answer (when one exists) is recorded as the comparison.
 *
 * FAILS LOUD on call errors and off-catalog choices — an enforced decision
 * has no fallback; the caller's retry ladder owns recovery. Evidence is
 * written first: every spec gets a row even when the call or one answer
 * failed. Rows are privacy-safe by construction: question ids, choice keys,
 * probabilities — never instructions text or state text.
 */
export async function runEnforcedBoundedDecisions(input: {
  userId: string
  surface: DecisionShadowSurface
  state: string
  specs: BoundedDecisionSpec[]
}): Promise<Map<string, DecisionChoiceAnswer>> {
  // Nothing to decide — no call, no rows, no activity row.
  if (input.specs.length === 0) return new Map()

  // Reject ambiguous argument shapes at the boundary, before any DB or LLM work.
  const seenIds = new Set<string>()
  for (const spec of input.specs) {
    if (!spec.id.trim()) throw new Error('[decision-plane] bounded question id must not be blank')
    if (seenIds.has(spec.id)) throw new Error(`[decision-plane] duplicate bounded question id "${spec.id}"`)
    seenIds.add(spec.id)
  }

  const resolved = resolveDecisionShadowConfigSafe()
  if (!resolved) {
    throw new Error(
      '[decision-plane] enforced bounded decisions require DECISION_SHADOW_ENABLED=true with a complete decision-model config',
    )
  }

  const startedAt = Date.now()
  const questions: Record<string, DecisionChoiceQuestion> = {}
  for (const spec of input.specs) {
    questions[spec.id] = spec.question
  }

  let res: DecisionResponse
  try {
    res = await runDecisionModel(resolved, { state: input.state, questions })
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const rows = input.specs.map((spec) => boundedRow(input, spec, null, durationMs, errorText(err)))
    await persistBoundedRows(input, input.specs, rows, null, durationMs, false)
    throw new Error(`[decision-plane] enforced bounded decision(s) failed: ${errorText(err)}`, {
      cause: err,
    })
  }

  const durationMs = Date.now() - startedAt
  const answers = new Map<string, DecisionChoiceAnswer>()
  const rows: Array<typeof decisionShadowLog.$inferInsert> = []
  let offCatalog: string | null = null
  for (const spec of input.specs) {
    const answer = res.answers[spec.id]
    if (!Object.hasOwn(spec.question.criteria, answer.choice)) {
      // All specs get their rows before the throw — the evidence persists.
      offCatalog = `[decision-plane] enforced ${spec.decisionKind} returned off-catalog choice "${answer.choice}"`
      rows.push(boundedRow(input, spec, null, durationMs, offCatalog))
      continue
    }
    answers.set(spec.id, answer)
    rows.push(boundedRow(input, spec, answer, durationMs, null))
  }

  await persistBoundedRows(input, input.specs, rows, res.reportedCostUsd, durationMs, res.cached === true)

  if (offCatalog) throw new Error(offCatalog)
  return answers
}

/**
 * Kicks the Decisions API call IMMEDIATELY so it runs concurrently with the
 * primary chat judge call. Returns null when the shadow is disabled and
 * nothing is enforced (nothing recorded). Otherwise returns a settle
 * function: await it with the authoritative decisions once classification
 * finished — enforced kinds' answers come back on the resolved value, and a
 * failure of an enforced kind REJECTS (into the ingest retry ladder).
 */
export function startDecisionShadow(
  ctx: DecisionShadowContext,
): ((primaries: DecisionShadowPrimaries) => Promise<EnforcedDecisions>) | null {
  const enforceKinds = resolveDecisionEnforceKinds()
  const startedAt = Date.now()
  const kinds = genericShadowKinds(ctx, enforceKinds)

  let config: DecisionShadowConfig | null
  try {
    config = resolveDecisionShadowConfig()
  } catch (err) {
    if (enforceKinds.size > 0) {
      // An enforced kind cannot run without its engine — fail loud instead
      // of writing error rows and silently deciding nothing.
      throw err
    }
    const message = err instanceof Error ? err.message : String(err)
    // Misconfiguration is recorded at settle time — visible, but never fatal.
    return async (primaries) => {
      const { enforced } = await recordRows(ctx, enforceKinds, kinds, primaries, {
        ok: false,
        error: message,
        durationMs: Date.now() - startedAt,
      })
      return enforced
    }
  }
  if (!config) {
    if (enforceKinds.size > 0) {
      throw new Error(
        `DECISION_ENFORCE_KINDS=${[...enforceKinds].join(',')} requires DECISION_SHADOW_ENABLED=true with a complete decision-model config`,
      )
    }
    return null
  }

  const questions = genericShadowQuestions(ctx, enforceKinds)
  const askedKinds = kinds.filter((k) => questions[k] !== undefined)

  const inflight: Promise<InflightOutcome> = runDecisionModel(config, {
    state: ctx.state,
    questions,
  }).then(
    (res) => {
      const byKind: Record<string, KindOutcome> = {}
      for (const kind of askedKinds) {
        const answer = res.answers[kind]
        const alternatives: Record<string, number> = {}
        for (const [key, prob] of Object.entries(answer.probabilities)) {
          if (key !== answer.choice) alternatives[key] = prob
        }
        byKind[kind] = {
          ok: true,
          choice: answer.choice,
          probability: answer.probabilities[answer.choice],
          alternatives,
        }
      }
      // content_role answered by the EARLY enforced call — carry it so its
      // row records the answer that actually drove the split.
      if (ctx.enforcedContentRole) {
        byKind['content_role'] = {
          ok: true,
          choice: ctx.enforcedContentRole.role,
          probability: ctx.enforcedContentRole.probability,
          alternatives: ctx.enforcedContentRole.alternatives,
        }
      }
      return {
        ok: true as const,
        byKind,
        reportedCostUsd: res.reportedCostUsd,
        cached: res.cached === true,
        durationMs: Date.now() - startedAt,
      }
    },
    (err) => ({
      ok: false as const,
      error: errorText(err),
      durationMs: Date.now() - startedAt,
    }),
  )

  return (primaries) => inflight.then((outcome) => settleRows(ctx, enforceKinds, kinds, primaries, outcome))
}

async function settleRows(
  ctx: DecisionShadowContext,
  enforceKinds: ReadonlySet<EnforceableDecisionKind>,
  kinds: DecisionKind[],
  primaries: DecisionShadowPrimaries,
  outcome: InflightOutcome,
): Promise<EnforcedDecisions> {
  // Record the evidence first — even when an enforced answer failed, the
  // rows document what happened — then fail loud below.
  const { enforced } = await recordRows(ctx, enforceKinds, kinds, primaries, outcome)

  if (!outcome.ok) {
    const failedEnforced = kinds.filter(
      (k) => enforceKinds.has(k as EnforceableDecisionKind) && k !== 'content_role',
    )
    if (failedEnforced.length > 0) {
      throw new Error(
        `[decision-plane] enforced decision(s) ${failedEnforced.join(',')} failed: ${outcome.error}`,
      )
    }
  }
  return enforced
}

async function recordRows(
  ctx: DecisionShadowContext,
  enforceKinds: ReadonlySet<EnforceableDecisionKind>,
  kinds: DecisionKind[],
  primaries: DecisionShadowPrimaries,
  outcome: InflightOutcome,
): Promise<{ enforced: EnforcedDecisions }> {
  const primaryByKind: Record<DecisionKind, { choice: string; confidence?: number | null } | undefined> = {
    category: primaries.category,
    content_role: primaries.contentRole,
    entity_type: primaries.entityType,
    // Per-item kinds never run through the generic shadow — no chat primary.
    relation_type: undefined,
    temporal_kind: undefined,
    // Whole-question kinds (runEnforcedBoundedDecisions) — no generic-shadow primary.
    retrieval_scope: undefined,
    query_temporal_kind: undefined,
    duration_unit: undefined,
    gtd_promotion: undefined,
    // Widened kinds — no generic-shadow primary; their wiring lands with the
    // resolution / delete-gate / chat-turn surfaces.
    resolution_choice: undefined,
    delete_target: undefined,
    message_intent: undefined,
    open_loop: undefined,
    salience_band: undefined,
  }

  const rows: Array<typeof decisionShadowLog.$inferInsert> = []
  const enforced: EnforcedDecisions = {}

  for (const kind of kinds) {
    const primary = primaryByKind[kind]
    if (!primary && !enforceKinds.has(kind as EnforceableDecisionKind)) {
      // A missing category/content_role/entity_type primary on the shadow
      // path is a call-site bug — loud, never fatal.
      console.error(`[decision-shadow] no primary decision for enabled kind "${kind}"`, {
        surface: ctx.surface,
      })
      continue
    }

    let kindOutcome: KindOutcome
    let durationMs = outcome.durationMs
    if (kind === 'content_role' && ctx.enforcedContentRole) {
      // Answer came from the early enforced call — always usable, even when
      // the later call failed (the inflight ok-branch also carries it).
      const earlyOutcome: KindOutcome = {
        ok: true,
        choice: ctx.enforcedContentRole.role,
        probability: ctx.enforcedContentRole.probability,
        alternatives: ctx.enforcedContentRole.alternatives,
      }
      kindOutcome = outcome.ok ? (outcome.byKind['content_role'] ?? earlyOutcome) : earlyOutcome
      durationMs = ctx.enforcedContentRole.durationMs
    } else {
      kindOutcome = outcome.ok ? outcome.byKind[kind] : { ok: false, error: outcome.error }
    }

    if (kind === 'category' && enforceKinds.has('category') && kindOutcome.ok) {
      enforced.category = {
        choice: kindOutcome.choice,
        probability: kindOutcome.probability,
        alternatives: kindOutcome.alternatives,
      }
    }

    rows.push({
      userId: ctx.userId,
      surface: ctx.surface,
      decisionKind: kind,
      llmChoice: primary?.choice ?? null,
      llmConfidence: primary?.confidence ?? null,
      decisionChoice: kindOutcome.ok ? kindOutcome.choice : null,
      decisionProbability: kindOutcome.ok ? kindOutcome.probability : null,
      decisionAlternatives: kindOutcome.ok ? kindOutcome.alternatives : null,
      agree:
        kindOutcome.ok && primary ? kindOutcome.choice === primary.choice : null,
      decisionError: kindOutcome.ok ? null : kindOutcome.error,
      decisionDurationMs: durationMs,
      authoritativeEngine: enforceKinds.has(kind as EnforceableDecisionKind)
        ? 'decision_model'
        : 'chat_judge',
    })
  }

  try {
    if (rows.length > 0) {
      const db = getDb()
      await db.insert(decisionShadowLog).values(rows)
    }
    // Cost transparency: one activity row per Decisions API call, full
    // provider-reported cost attributed exactly once — even when no pair was
    // comparable, the call still happened.
    await logActivityCall(getDb(), ctx.userId, {
      provider: 'openrouter',
      operation: 'decision_shadow',
      // Provider-reported USD (usage.cost); 0 when absent — never inferred.
      baseCostUsd: outcome.ok ? (outcome.reportedCostUsd ?? 0) : 0,
      gatewayHost: 'openrouter.ai',
      context: `decision_shadow kinds=${kinds.join(',')} surface=${ctx.surface}`,
      durationMs: outcome.durationMs,
      cached: outcome.ok && outcome.cached,
    })
  } catch (err) {
    // The shadow must never break capture — but failures stay loud.
    console.error('[decision-shadow] failed to record shadow rows', err)
  }

  return { enforced }
}

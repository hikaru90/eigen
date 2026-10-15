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
import { getDb } from '$lib/server/db'
import { decisionShadowLog } from '$lib/server/db/schema'
import {
  resolveDecisionEnforceKinds,
  resolveDecisionShadowConfig,
  runDecisionModel,
  type DecisionChoiceQuestion,
  type DecisionShadowConfig,
  type EnforceableDecisionKind,
} from './decision-client'

export type DecisionShadowSurface = 'capture_service' | 'enrich_queued'

export type DecisionKind = 'category' | 'content_role' | 'entity_type'

/** The mode answer for the content-split decision. */
export type ContentRoleMode = 'thought_only' | 'split'

export type DecisionCatalogKind = { key: string; name: string; definition: string }

/** The early content_role decision when the kind is decision-model authoritative. */
export type EnforcedContentRole = {
  mode: ContentRoleMode
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
  /** Enables the `content_role` question (thought_only vs split). */
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
   * Chat content-split decision — absent when enforcement skipped the chat
   * call entirely (content_role=thought_only no longer runs it).
   */
  contentRole?: { choice: ContentRoleMode; confidence?: number | null }
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

const CONTENT_ROLE_CRITERIA: Record<string, string> = {
  thought_only:
    'A self-contained thought (task, bug report, ordinary note) — store the text itself as the thought.',
  split:
    'Reference material (recipe, template, procedure, transcript, pasted document) — store a distilled pointer as the thought plus the full body as a linked note.',
}

const CATEGORY_INSTRUCTIONS = 'Which ontology thought category best matches this captured thought?'
const CONTENT_ROLE_INSTRUCTIONS =
  'Is this captured input one self-contained thought, or reference material that should be split into a linked note?'
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
      durationMs: number
    }
  | { ok: false; error: string; durationMs: number }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Early content_role decision for the ENFORCED path (spec §6 P): one
 * Decisions API call with only the content_role question, kicked before the
 * content_split phase so the pipeline can act on the mode (skip the split
 * chat call for thought_only). Returns null when content_role is not
 * enforced — the caller keeps the shadow-only flow.
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
      if (answer.choice !== 'thought_only' && answer.choice !== 'split') {
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
        })
      } catch (err) {
        console.error('[decision-plane] failed to record content_role activity row', err)
      }
      return {
        mode: answer.choice,
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
  const kinds = enabledKinds(ctx)

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

  const questions = decisionQuestionsFor(ctx)
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
          choice: ctx.enforcedContentRole.mode,
          probability: ctx.enforcedContentRole.probability,
          alternatives: ctx.enforcedContentRole.alternatives,
        }
      }
      return {
        ok: true as const,
        byKind,
        reportedCostUsd: res.reportedCostUsd,
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
        choice: ctx.enforcedContentRole.mode,
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
    })
  } catch (err) {
    // The shadow must never break capture — but failures stay loud.
    console.error('[decision-shadow] failed to record shadow rows', err)
  }

  return { enforced }
}

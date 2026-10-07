/**
 * Decision-model plane for thought ingest (OpenRouter Decisions API, e.g.
 * typesafe/jev-1.13) — spec: docs/planning/09-jev-decision-plane.md.
 *
 * Runs the decision model SIDE BY SIDE with the authoritative chat judge on
 * every capture. The chat decision stays authoritative — stored rows never
 * change. Shadow results are recorded as metadata-only diagnostics (bounded
 * choice keys, probabilities, errors) so disagreement and calibration can be
 * reviewed per decision kind before any promotion (spec §6 P-gate).
 *
 * Question design rule (spec §2): a question is a Jev question only when the
 * answer is a key from a closed catalog. Free-form extraction stays on the
 * chat judge; embeddings stay on the embedding gateway; entry-channel
 * metadata stays structural.
 *
 * Guarantees (inherited from the category shadow, now per kind):
 * - Zero behavior change: settle() never throws into capture, even when the
 *   Decisions API, the config, or the log insert itself fails. Failures are
 *   recorded as first-class error rows (agree = null, decision_error set)
 *   plus console.error — loud, deterministic, no silent fallback.
 * - Privacy: rows contain choice keys, probabilities, timings and errors
 *   only — never thought text, thought ids, or bodies.
 * - Cost transparency: exactly ONE activity_call_log row per Decisions API
 *   call with the provider-reported cost attributed once (not per kind).
 */

import { logActivityCall } from '$lib/server/activity/log-call'
import { getDb } from '$lib/server/db'
import { decisionShadowLog } from '$lib/server/db/schema'
import {
  resolveDecisionShadowConfig,
  runDecisionModel,
  type DecisionChoiceQuestion,
  type DecisionShadowConfig,
} from './decision-client'

export type DecisionShadowSurface = 'capture_service' | 'enrich_queued'

export type DecisionKind = 'category' | 'content_role' | 'entity_type'

export type DecisionCatalogKind = { key: string; name: string; definition: string }

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
}

export type DecisionShadowPrimaries = {
  /** Authoritative category decision — always required. */
  category: { choice: string; confidence: number | null }
  /** Authoritative content-split decision — required when contentRoleEnabled. */
  contentRole?: { choice: 'thought_only' | 'split'; confidence?: number | null }
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
  if (ctx.contentRoleEnabled) {
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

/** Kinds whose questions this context enables. */
function enabledKinds(ctx: DecisionShadowContext): DecisionKind[] {
  const kinds: DecisionKind[] = ['category']
  if (ctx.contentRoleEnabled) kinds.push('content_role')
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

/**
 * Kicks the Decisions API call IMMEDIATELY so it runs concurrently with the
 * primary chat judge call. Returns null when the shadow is disabled (nothing
 * recorded). Otherwise returns a settle function: await it with the
 * authoritative decisions once classification finished.
 */
export function startDecisionShadow(ctx: DecisionShadowContext): ((primaries: DecisionShadowPrimaries) => Promise<void>) | null {
  const startedAt = Date.now()
  const kinds = enabledKinds(ctx)

  let config: DecisionShadowConfig | null
  try {
    config = resolveDecisionShadowConfig()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Misconfiguration is recorded at settle time — visible, but never fatal.
    return (primaries) => recordRows(ctx, kinds, primaries, { ok: false, error: message, durationMs: Date.now() - startedAt })
  }
  if (!config) return null

  const inflight: Promise<InflightOutcome> = runDecisionModel(config, {
    state: ctx.state,
    questions: decisionQuestionsFor(ctx),
  }).then(
    (res) => {
      const byKind: Record<string, KindOutcome> = {}
      for (const kind of kinds) {
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
      return {
        ok: true as const,
        byKind,
        reportedCostUsd: res.reportedCostUsd,
        durationMs: Date.now() - startedAt,
      }
    },
    (err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    }),
  )

  return (primaries) => inflight.then((outcome) => recordRows(ctx, kinds, primaries, outcome))
}

async function recordRows(
  ctx: DecisionShadowContext,
  kinds: DecisionKind[],
  primaries: DecisionShadowPrimaries,
  outcome: InflightOutcome,
): Promise<void> {
  const primaryByKind: Record<DecisionKind, { choice: string; confidence?: number | null } | undefined> = {
    category: primaries.category,
    content_role: primaries.contentRole,
    entity_type: primaries.entityType,
  }

  const rows: Array<typeof decisionShadowLog.$inferInsert> = []
  for (const kind of kinds) {
    const primary = primaryByKind[kind]
    if (!primary) {
      // entity_type has no comparable pair when the bundle extracted no
      // mentions; a missing category/content_role primary would be a call-site
      // bug — loud, never fatal.
      console.error(`[decision-shadow] no primary decision for enabled kind "${kind}"`, {
        surface: ctx.surface,
      })
      continue
    }
    const kindOutcome: KindOutcome =
      outcome.ok ? outcome.byKind[kind] : { ok: false, error: outcome.error }
    rows.push({
      userId: ctx.userId,
      surface: ctx.surface,
      decisionKind: kind,
      llmChoice: primary.choice,
      llmConfidence: primary.confidence ?? null,
      decisionChoice: kindOutcome.ok ? kindOutcome.choice : null,
      decisionProbability: kindOutcome.ok ? kindOutcome.probability : null,
      decisionAlternatives: kindOutcome.ok ? kindOutcome.alternatives : null,
      agree: kindOutcome.ok ? kindOutcome.choice === primary.choice : null,
      decisionError: kindOutcome.ok ? null : kindOutcome.error,
      decisionDurationMs: outcome.durationMs,
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
}

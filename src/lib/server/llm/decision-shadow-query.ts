/**
 * Per-user read model for the decision-model shadow panel (capture page).
 *
 * Metadata-only by construction: decision_shadow_log rows carry choice keys,
 * probabilities, timings, and errors — never thought text or thought ids.
 * The panel is purely observational; the stored decisions (chat judge)
 * remain authoritative. Rows are grouped by decision kind per the decision
 * plane spec (docs/planning/09-jev-decision-plane.md).
 */

import { and, desc, eq, sql } from 'drizzle-orm'
import type { AppDatabase } from '$lib/server/db/context'
import { decisionShadowLog } from '$lib/server/db/schema'

export type DecisionShadowSummary = {
  total: number
  compared: number
  agreed: number
  disagreed: number
  errored: number
  /** agreed / compared over comparable pairs; null while compared === 0. */
  agreementRate: number | null
}

export type DecisionKindSummary = DecisionShadowSummary & {
  decisionKind: string
  /** Engine that owns this kind per its most recent row: `chat_judge` | `decision_model`. */
  authoritativeEngine: string
}

export type DecisionShadowPair = {
  decisionKind: string
  llmChoice: string
  decisionChoice: string | null
  count: number
}

export type DecisionShadowRecentRow = {
  id: string
  /** ISO timestamp — serialized plain for deterministic wire/hydration. */
  createdAt: string
  surface: string
  decisionKind: string
  llmChoice: string | null
  llmConfidence: number | null
  decisionChoice: string | null
  decisionProbability: number | null
  agree: boolean | null
  decisionError: string | null
  decisionDurationMs: number | null
  /** `chat_judge` (shadow) | `decision_model` (enforced). */
  authoritativeEngine: string
}

export type DecisionShadowView = {
  summary: DecisionShadowSummary
  /** Per-kind summaries, ordered by total desc then kind asc. */
  kinds: DecisionKindSummary[]
  confusionPairs: DecisionShadowPair[]
  recent: DecisionShadowRecentRow[]
}

/** Bare row shape accepted by the pure summarizer (testable without drizzle). */
export type DecisionShadowRowInput = {
  id: string
  createdAt: string
  surface: string
  decisionKind: string
  llmChoice: string | null
  llmConfidence: number | null
  decisionChoice: string | null
  decisionProbability: number | null
  agree: boolean | null
  decisionError: string | null
  decisionDurationMs: number | null
  authoritativeEngine: string
}

const DEFAULT_RECENT_LIMIT = 20

function summarizeKind(kind: string, rows: DecisionShadowRowInput[]): DecisionKindSummary {
  const comparedRows = rows.filter((r) => r.agree !== null)
  const agreed = comparedRows.filter((r) => r.agree === true).length
  const disagreed = comparedRows.length - agreed
  // Errored = the decision-model call itself failed. A successful answer with
  // no chat primary (authoritative Jev, chat skipped) is neither compared nor
  // errored.
  const errored = rows.filter((r) => r.decisionError !== null).length
  const latest = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0]
  return {
    decisionKind: kind,
    total: rows.length,
    compared: comparedRows.length,
    agreed,
    disagreed,
    errored,
    agreementRate: comparedRows.length > 0 ? agreed / comparedRows.length : null,
    authoritativeEngine: latest?.authoritativeEngine ?? 'chat_judge',
  }
}

function emptySummary(): DecisionShadowSummary {
  return {
    total: 0,
    compared: 0,
    agreed: 0,
    disagreed: 0,
    errored: 0,
    agreementRate: null,
  }
}

export function summarizeShadowRows(
  rows: DecisionShadowRowInput[],
  recentLimit: number = DEFAULT_RECENT_LIMIT,
): { summary: DecisionShadowSummary; kinds: DecisionKindSummary[]; confusionPairs: DecisionShadowPair[]; recent: DecisionShadowRecentRow[] } {
  const comparedRows = rows.filter((r) => r.agree !== null)
  const agreed = comparedRows.filter((r) => r.agree === true).length
  const disagreed = comparedRows.length - agreed
  const errored = rows.filter((r) => r.decisionError !== null).length
  const summary: DecisionShadowSummary = {
    total: rows.length,
    compared: comparedRows.length,
    agreed,
    disagreed,
    errored,
    agreementRate: comparedRows.length > 0 ? agreed / comparedRows.length : null,
  }

  const kinds = [...new Set(rows.map((r) => r.decisionKind))]
    .map((kind) => summarizeKind(kind, rows.filter((r) => r.decisionKind === kind)))
    .sort((a, b) => b.total - a.total || a.decisionKind.localeCompare(b.decisionKind))

  const pairCounts = new Map<string, DecisionShadowPair>()
  for (const r of rows) {
    // A disagreement implies both sides answered — llmChoice is present.
    if (r.agree !== false || r.llmChoice === null) continue
    const key = `${r.decisionKind}\u0000${r.llmChoice}\u0000${r.decisionChoice ?? ''}`
    const existing = pairCounts.get(key)
    if (existing) existing.count += 1
    else
      pairCounts.set(key, {
        decisionKind: r.decisionKind,
        llmChoice: r.llmChoice,
        decisionChoice: r.decisionChoice,
        count: 1,
      })
  }
  const confusionPairs = [...pairCounts.values()].sort((a, b) => b.count - a.count)

  const recent = [...rows]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, recentLimit)

  return { summary, kinds, confusionPairs, recent }
}

/**
 * Loads the shadow view for one user. Every query is scoped by the session
 * userId — other users' rows are unreachable (plus RLS on the table itself).
 */
export async function loadDecisionShadowSummary(db: AppDatabase, userId: string): Promise<DecisionShadowView> {
  const kindRows = await db
    .select({
      decisionKind: decisionShadowLog.decisionKind,
      total: sql<number>`count(*)::int`,
      agreed: sql<number>`count(*) filter (where ${decisionShadowLog.agree} is true)::int`,
      disagreed: sql<number>`count(*) filter (where ${decisionShadowLog.agree} is false)::int`,
      errored: sql<number>`count(*) filter (where ${decisionShadowLog.decisionError} is not null)::int`,
      authoritativeEngine: sql<string>`(array_agg(${decisionShadowLog.authoritativeEngine} order by ${decisionShadowLog.createdAt} desc))[1]`,
    })
    .from(decisionShadowLog)
    .where(eq(decisionShadowLog.userId, userId))
    .groupBy(decisionShadowLog.decisionKind)

  const confusionPairs = await db
    .select({
      decisionKind: decisionShadowLog.decisionKind,
      // agree=false implies both engines answered — llm_choice is non-null.
      llmChoice: sql<string>`${decisionShadowLog.llmChoice}`,
      decisionChoice: decisionShadowLog.decisionChoice,
      count: sql<number>`count(*)::int`,
    })
    .from(decisionShadowLog)
    .where(and(eq(decisionShadowLog.userId, userId), eq(decisionShadowLog.agree, false)))
    .groupBy(decisionShadowLog.decisionKind, decisionShadowLog.llmChoice, decisionShadowLog.decisionChoice)
    .orderBy(sql`count(*) desc`)
    .limit(25)

  const recentRows = await db
    .select({
      id: decisionShadowLog.id,
      createdAt: decisionShadowLog.createdAt,
      surface: decisionShadowLog.surface,
      decisionKind: decisionShadowLog.decisionKind,
      llmChoice: decisionShadowLog.llmChoice,
      llmConfidence: decisionShadowLog.llmConfidence,
      decisionChoice: decisionShadowLog.decisionChoice,
      decisionProbability: decisionShadowLog.decisionProbability,
      agree: decisionShadowLog.agree,
      decisionError: decisionShadowLog.decisionError,
      decisionDurationMs: decisionShadowLog.decisionDurationMs,
      authoritativeEngine: decisionShadowLog.authoritativeEngine,
    })
    .from(decisionShadowLog)
    .where(eq(decisionShadowLog.userId, userId))
    .orderBy(desc(decisionShadowLog.createdAt))
    .limit(DEFAULT_RECENT_LIMIT)

  const kinds: DecisionKindSummary[] = kindRows
    .map((k) => ({
      decisionKind: k.decisionKind,
      total: k.total,
      compared: k.agreed + k.disagreed,
      agreed: k.agreed,
      disagreed: k.disagreed,
      errored: k.errored,
      agreementRate: k.agreed + k.disagreed > 0 ? k.agreed / (k.agreed + k.disagreed) : null,
      authoritativeEngine: k.authoritativeEngine,
    }))
    .sort((a, b) => b.total - a.total || a.decisionKind.localeCompare(b.decisionKind))

  const summary = kinds.reduce<DecisionShadowSummary>((acc, k) => {
    acc.total += k.total
    acc.agreed += k.agreed
    acc.disagreed += k.disagreed
    acc.errored += k.errored
    return acc
  }, emptySummary())
  summary.compared = summary.agreed + summary.disagreed
  summary.agreementRate = summary.compared > 0 ? summary.agreed / summary.compared : null

  return {
    summary,
    kinds,
    confusionPairs,
    recent: recentRows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  }
}

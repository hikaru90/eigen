/**
 * GET /api/admin/decision-shadow
 *
 * Decision-model shadow (OpenRouter Decisions API) for ingest classification:
 * per-kind agreement summary + recent shadow rows for discrepancy review.
 * Metadata-only: rows contain choice keys, probabilities, timings, errors —
 * no thought text, thought ids, or bodies.
 *
 * Auth: X-Admin-Key (ADMIN_CONSOLIDATION_KEY).
 */

import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { desc, sql } from 'drizzle-orm'
import { requireAdminKey } from '$lib/server/auth/admin-key'
import { getDb } from '$lib/server/db'
import { decisionShadowLog } from '$lib/server/db/schema'

export const GET: RequestHandler = async (event) => {
  requireAdminKey(event)
  const db = getDb()

  const kinds = await db
    .select({
      decisionKind: decisionShadowLog.decisionKind,
      total: sql<number>`count(*)::int`,
      compared: sql<number>`count(${decisionShadowLog.agree})::int`,
      agreed: sql<number>`count(*) filter (where ${decisionShadowLog.agree} is true)::int`,
      disagreed: sql<number>`count(*) filter (where ${decisionShadowLog.agree} is false)::int`,
      errored: sql<number>`count(*) filter (where ${decisionShadowLog.decisionError} is not null)::int`,
      authoritativeEngine: sql<string>`(array_agg(${decisionShadowLog.authoritativeEngine} order by ${decisionShadowLog.createdAt} desc))[1]`,
    })
    .from(decisionShadowLog)
    .groupBy(decisionShadowLog.decisionKind)

  const confusion = await db
    .select({
      decisionKind: decisionShadowLog.decisionKind,
      llmChoice: decisionShadowLog.llmChoice,
      decisionChoice: decisionShadowLog.decisionChoice,
      count: sql<number>`count(*)::int`,
    })
    .from(decisionShadowLog)
    .where(sql`${decisionShadowLog.agree} is false`)
    .groupBy(decisionShadowLog.decisionKind, decisionShadowLog.llmChoice, decisionShadowLog.decisionChoice)
    .orderBy(sql`count(*) desc`)
    .limit(25)

  const recent = await db
    .select({
      id: decisionShadowLog.id,
      createdAt: decisionShadowLog.createdAt,
      surface: decisionShadowLog.surface,
      decisionKind: decisionShadowLog.decisionKind,
      llmChoice: decisionShadowLog.llmChoice,
      llmConfidence: decisionShadowLog.llmConfidence,
      decisionChoice: decisionShadowLog.decisionChoice,
      decisionProbability: decisionShadowLog.decisionProbability,
      decisionAlternatives: decisionShadowLog.decisionAlternatives,
      agree: decisionShadowLog.agree,
      decisionError: decisionShadowLog.decisionError,
      decisionDurationMs: decisionShadowLog.decisionDurationMs,
      authoritativeEngine: decisionShadowLog.authoritativeEngine,
    })
    .from(decisionShadowLog)
    .orderBy(desc(decisionShadowLog.createdAt))
    .limit(20)

  return json({ kinds, confusion, recent })
}

/**
 * Operator view of capture quality (docs/planning/capture-feedback.md §8): COUNTS ONLY, across all
 * tenants. Every number comes from aggregate SQL. The queries never select thought, entity or reason
 * columns and never select an id (a per-review row number exists inside the query only, to group
 * parts per review). The result is parsed with a strict schema, so a shape the page does not expect
 * (an unknown status, part kind or reason kind) throws instead of being shown.
 *
 * Float trap: `capture_review.score` is a `real` (float4) and the `parts` probabilities are float8.
 * A bound JS number such as 0.7 compares as float8, so a stored real 0.7 (0.699999988...) would count
 * as below 0.7. The score is therefore compared against real-cast bounds, and the weakest part is
 * computed from the jsonb probabilities themselves, never against the `score` column.
 */

import { z } from 'zod'
import { createAdminSql } from '$lib/server/job-queue/admin-db'
import { QUALITY_BANDS } from '$lib/utils/capture-quality-rates'
import { CAPTURE_REASON_KINDS } from './reason-question'
import {
  CAPTURE_REVIEW_THRESHOLD,
  REVIEW_AUDIT_PARTS,
  REVIEW_DECISION_KINDS,
  SCORED_PARTS,
} from './review-parts'

const PART_KINDS = [...REVIEW_DECISION_KINDS, ...REVIEW_AUDIT_PARTS] as const

const count = z.number().int().min(0)
const upDown = z.strictObject({ up: count, down: count })
const bandCounts = z.strictObject({
  reviews: count,
  voted: count,
  up: count,
  down: count,
})
const bandsSchema = z.strictObject(
  Object.fromEntries(QUALITY_BANDS.map((b) => [b, bandCounts])) as Record<
    (typeof QUALITY_BANDS)[number],
    typeof bandCounts
  >,
)

const partSchema = z.strictObject({
  scored: z.boolean(),
  weakest: count,
  bands: bandsSchema,
})

export const captureQualitySchema = z.strictObject({
  totals: z.strictObject({
    reviews: count,
    status: z.strictObject({ pending_audit: count, scored: count, audit_failed: count }),
    scoredBelowThreshold: count,
    scoredAtOrAboveThreshold: count,
    votes: z.strictObject({ capture: upDown, mesh: upDown, mcp: upDown }),
    votesWithoutScore: count,
    downWithoutReason: count,
  }),
  scoreBands: bandsSchema,
  parts: z.strictObject(
    Object.fromEntries(PART_KINDS.map((k) => [k, partSchema])) as Record<
      (typeof PART_KINDS)[number],
      typeof partSchema
    >,
  ),
  reasonKinds: z.strictObject(
    Object.fromEntries(CAPTURE_REASON_KINDS.map((k) => [k, count])) as Record<
      (typeof CAPTURE_REASON_KINDS)[number],
      typeof count
    >,
  ),
  threshold: z.number().min(0).max(1),
})

export type CaptureQuality = z.infer<typeof captureQualitySchema>

type BandRow = {
  band: string
  reviews: number
  voted: number
  up: number
  down: number
}

function emptyBand() {
  return { reviews: 0, voted: 0, up: 0, down: 0 }
}

function emptyBands(): Record<string, ReturnType<typeof emptyBand>> {
  return Object.fromEntries(QUALITY_BANDS.map((b) => [b, emptyBand()]))
}

export async function loadCaptureQuality(options: {
  includeHarness: boolean
}): Promise<CaptureQuality> {
  const { includeHarness } = options
  const sql = createAdminSql(1)
  try {
    const scoredParts = sql.array([...SCORED_PARTS], 25)
    const t = CAPTURE_REVIEW_THRESHOLD

    // Reviews of the chosen accounts, with a row number that lives inside the query only.
    const reviews = sql`
      SELECT
        ROW_NUMBER() OVER () AS rid,
        cr.status, cr.score, cr.verdict, cr.voted_on, cr.reason_encrypted, cr.reason_kind, cr.parts
      FROM capture_review cr
      JOIN "user" u ON u.id = cr.user_id
      WHERE (${includeHarness}::boolean OR u.account_kind = 'production')
    `

    const [totals] = await sql<
      {
        reviews: number
        pending_audit: number
        scored: number
        audit_failed: number
        below: number
        at_or_above: number
        capture_up: number
        capture_down: number
        mesh_up: number
        mesh_down: number
        mcp_up: number
        mcp_down: number
        votes_without_score: number
        down_without_reason: number
      }[]
    >`
      WITH rv AS (${reviews})
      SELECT
        COUNT(*)::int AS reviews,
        (COUNT(*) FILTER (WHERE status = 'pending_audit'))::int AS pending_audit,
        (COUNT(*) FILTER (WHERE status = 'scored'))::int AS scored,
        (COUNT(*) FILTER (WHERE status = 'audit_failed'))::int AS audit_failed,
        (COUNT(*) FILTER (WHERE status = 'scored' AND score < ${t}::real))::int AS below,
        (COUNT(*) FILTER (WHERE status = 'scored' AND score >= ${t}::real))::int AS at_or_above,
        (COUNT(*) FILTER (WHERE verdict = 'up' AND voted_on = 'capture'))::int AS capture_up,
        (COUNT(*) FILTER (WHERE verdict = 'down' AND voted_on = 'capture'))::int AS capture_down,
        (COUNT(*) FILTER (WHERE verdict = 'up' AND voted_on = 'mesh'))::int AS mesh_up,
        (COUNT(*) FILTER (WHERE verdict = 'down' AND voted_on = 'mesh'))::int AS mesh_down,
        (COUNT(*) FILTER (WHERE verdict = 'up' AND voted_on IS NULL))::int AS mcp_up,
        (COUNT(*) FILTER (WHERE verdict = 'down' AND voted_on IS NULL))::int AS mcp_down,
        (COUNT(*) FILTER (WHERE verdict IS NOT NULL AND score IS NULL))::int AS votes_without_score,
        (COUNT(*) FILTER (WHERE verdict = 'down' AND reason_encrypted IS NULL))::int
          AS down_without_reason
      FROM rv
    `

    const scoreBandRows = await sql<BandRow[]>`
      WITH rv AS (${reviews}),
      banded AS (
        SELECT verdict,
          CASE
            WHEN score < ${0.5}::real THEN 'lt_0_5'
            WHEN score < ${0.7}::real THEN '0_5_to_0_7'
            WHEN score < ${0.9}::real THEN '0_7_to_0_9'
            ELSE 'gte_0_9'
          END AS band
        FROM rv
        WHERE status = 'scored' AND score IS NOT NULL
      )
      SELECT band,
        COUNT(*)::int AS reviews,
        (COUNT(verdict))::int AS voted,
        (COUNT(*) FILTER (WHERE verdict = 'up'))::int AS up,
        (COUNT(*) FILTER (WHERE verdict = 'down'))::int AS down
      FROM banded
      GROUP BY band
    `

    // One probability per review and part kind: the weakest of that kind (a review with three
    // names counts once, by its weakest name). Probabilities come from the jsonb, never from `score`.
    const partRows = await sql<(BandRow & { part: string })[]>`
      WITH rv AS (${reviews}),
      per_part AS (
        SELECT rv.rid, rv.verdict, p->>'part' AS part,
          MIN((p->>'probability')::float8) AS prob
        FROM rv, jsonb_array_elements(rv.parts) AS p
        WHERE rv.status = 'scored'
        GROUP BY rv.rid, rv.verdict, p->>'part'
      )
      SELECT part,
        CASE
          WHEN prob < ${0.5}::float8 THEN 'lt_0_5'
          WHEN prob < ${0.7}::float8 THEN '0_5_to_0_7'
          WHEN prob < ${0.9}::float8 THEN '0_7_to_0_9'
          ELSE 'gte_0_9'
        END AS band,
        COUNT(*)::int AS reviews,
        (COUNT(verdict))::int AS voted,
        (COUNT(*) FILTER (WHERE verdict = 'up'))::int AS up,
        (COUNT(*) FILTER (WHERE verdict = 'down'))::int AS down
      FROM per_part
      GROUP BY part, 2
    `

    // How often each scored kind held the lowest probability of its review (ties count each kind).
    const weakestRows = await sql<{ part: string; weakest: number }[]>`
      WITH rv AS (${reviews}),
      per_part AS (
        SELECT rv.rid, p->>'part' AS part, MIN((p->>'probability')::float8) AS prob
        FROM rv, jsonb_array_elements(rv.parts) AS p
        WHERE rv.status = 'scored'
        GROUP BY rv.rid, p->>'part'
      ),
      scored_only AS (
        SELECT * FROM per_part
        WHERE part = ANY(${scoredParts})
      ),
      lowest AS (SELECT rid, MIN(prob) AS prob FROM scored_only GROUP BY rid)
      SELECT s.part, COUNT(*)::int AS weakest
      FROM scored_only s
      JOIN lowest l ON l.rid = s.rid AND l.prob = s.prob
      GROUP BY s.part
    `

    const reasonRows = await sql<{ reason_kind: string; n: number }[]>`
      WITH rv AS (${reviews})
      SELECT reason_kind, COUNT(*)::int AS n
      FROM rv
      WHERE verdict = 'down' AND reason_kind IS NOT NULL
      GROUP BY reason_kind
    `

    const scoredSet: ReadonlySet<string> = new Set(SCORED_PARTS)
    const parts: Record<
      string,
      { scored: boolean; weakest: number; bands: Record<string, ReturnType<typeof emptyBand>> }
    > = Object.fromEntries(
      PART_KINDS.map((k) => [k, { scored: scoredSet.has(k), weakest: 0, bands: emptyBands() }]),
    )
    for (const r of partRows) {
      // An unknown kind is added so that the strict schema rejects it.
      parts[r.part] ??= { scored: false, weakest: 0, bands: emptyBands() }
      parts[r.part].bands[r.band] = { reviews: r.reviews, voted: r.voted, up: r.up, down: r.down }
    }
    for (const r of weakestRows) {
      parts[r.part] ??= { scored: false, weakest: 0, bands: emptyBands() }
      parts[r.part].weakest = r.weakest
    }

    const scoreBands = emptyBands()
    for (const r of scoreBandRows) {
      scoreBands[r.band] = { reviews: r.reviews, voted: r.voted, up: r.up, down: r.down }
    }

    const reasonKinds: Record<string, number> = Object.fromEntries(
      CAPTURE_REASON_KINDS.map((k) => [k, 0]),
    )
    for (const r of reasonRows) reasonKinds[r.reason_kind] = r.n

    return captureQualitySchema.parse({
      totals: {
        reviews: totals.reviews,
        status: {
          pending_audit: totals.pending_audit,
          scored: totals.scored,
          audit_failed: totals.audit_failed,
        },
        scoredBelowThreshold: totals.below,
        scoredAtOrAboveThreshold: totals.at_or_above,
        votes: {
          capture: { up: totals.capture_up, down: totals.capture_down },
          mesh: { up: totals.mesh_up, down: totals.mesh_down },
          mcp: { up: totals.mcp_up, down: totals.mcp_down },
        },
        votesWithoutScore: totals.votes_without_score,
        downWithoutReason: totals.down_without_reason,
      },
      scoreBands,
      parts,
      reasonKinds,
      threshold: CAPTURE_REVIEW_THRESHOLD,
    })
  } finally {
    await sql.end()
  }
}

import type { CaptureReviewPart } from './review-parts'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { user } from '$lib/server/db/auth.schema'
import { captureReview, thought } from '$lib/server/db/brain.schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'

/**
 * Operator capture-quality aggregates against the real database (docs/planning/capture-feedback.md
 * §8). The DB is shared, so every assertion is on the DELTA between a read before and after the
 * inserts. The inserted user is a harness account.
 */
const hasDb = Boolean(process.env.DATABASE_URL)

type Loaded = Awaited<ReturnType<typeof import('./admin-quality').loadCaptureQuality>>

/** after - before for every number; non-numbers are taken from `after`. */
function delta(after: unknown, before: unknown): unknown {
  if (typeof after === 'number' && typeof before === 'number') return after - before
  if (after && typeof after === 'object' && before && typeof before === 'object') {
    return Object.fromEntries(
      Object.entries(after).map(([k, v]) => [k, delta(v, (before as Record<string, unknown>)[k])]),
    )
  }
  return after
}

const band = (reviews: number, voted: number, up: number, down: number) => ({
  reviews,
  voted,
  up,
  down,
})

function part(
  kind: CaptureReviewPart['part'],
  ref: string,
  probability: number,
  engine: CaptureReviewPart['engine'],
): CaptureReviewPart {
  return { part: kind, ref, engine, label: 'x', probability }
}

describe.skipIf(!hasDb)('capture quality aggregates', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb
  let loadCaptureQuality: typeof import('./admin-quality').loadCaptureQuality

  const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`
  const userId = `cq_user_${suffix}`
  const texts: string[] = []
  const ids: string[] = [userId]
  let before: Loaded
  let beforeProd: Loaded
  let after: Loaded
  let afterProd: Loaded

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb
    ;({ loadCaptureQuality } = await import('./admin-quality'))

    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: userId,
        name: 'Capture Quality',
        email: `${userId}@quality.test`,
        emailVerified: true,
        onboardingCompleted: true,
        accountKind: 'harness',
      })
    })
    const { ensureUserOntologySeeded } = await import('$lib/server/ontology-db')
    await withEvalDb(userId, async (db) => ensureUserOntologySeeded(db, userId))

    before = await loadCaptureQuality({ includeHarness: true })
    beforeProd = await loadCaptureQuality({ includeHarness: false })

    type Row = Partial<typeof captureReview.$inferInsert> &
      Pick<typeof captureReview.$inferInsert, 'status' | 'parts'>
    const rows: Row[] = [
      // R1: exactly 0.7 (a real) is "at or above" and in band 0_7_to_0_9; category is weakest.
      {
        status: 'scored',
        score: 0.7,
        verdict: 'up',
        votedOn: 'capture',
        parts: [
          part('category', 'm0', 0.7, 'jev_decision'),
          part('wording', 'wording', 0.95, 'jev_audit'),
          part('name', 'name:n1', 0.8, 'jev_audit'),
        ],
      },
      // R2: wording and date tie for weakest.
      {
        status: 'scored',
        score: 0.4,
        verdict: 'down',
        votedOn: 'mesh',
        reasonEncrypted: 'enc',
        reasonKind: 'wrong_date',
        parts: [
          part('category', 'm0', 0.9, 'jev_decision'),
          part('wording', 'wording', 0.4, 'jev_audit'),
          part('date', 'date:d1', 0.4, 'jev_audit'),
        ],
      },
      // R3: two names (banded by the weaker one, exactly 0.5), a recorded-only part, a vote cast
      // over MCP (voted_on NULL) with no reason.
      {
        status: 'scored',
        score: 0.5,
        verdict: 'down',
        votedOn: null,
        parts: [
          part('category', 'm0', 0.95, 'jev_decision'),
          part('name', 'name:n1', 0.5, 'jev_audit'),
          part('name', 'name:n2', 0.9, 'jev_audit'),
          part('entity_type', 'm1', 0.2, 'jev_decision'),
        ],
      },
      // R4: sure, not voted.
      {
        status: 'scored',
        score: 0.95,
        parts: [
          part('category', 'm0', 0.95, 'jev_decision'),
          part('piece', 'piece:p1', 0.97, 'jev_audit'),
        ],
      },
      // R5: a vote on a review that has no score.
      { status: 'pending_audit', parts: [], verdict: 'up', votedOn: 'capture' },
      // R6: the audit failed.
      { status: 'audit_failed', parts: [], auditError: 'audit failed' },
      // R7: weak category, thumbs down on the capture strip with a reason.
      {
        status: 'scored',
        score: 0.3,
        verdict: 'down',
        votedOn: 'capture',
        reasonEncrypted: 'enc',
        reasonKind: 'wrong_name',
        parts: [part('category', 'm0', 0.3, 'jev_decision')],
      },
    ]

    await withEvalDb(userId, async (db) => {
      for (let i = 0; i < rows.length; i++) {
        const text = `cq_secret_${suffix}_${i} private words`
        texts.push(text)
        const [t] = await db
          .insert(thought)
          .values({
            userId,
            rawText: text,
            normalizedText: text,
            lexicalText: computeLexicalText(text),
            category: 'task',
          })
          .returning({ id: thought.id })
        const [r] = await db
          .insert(captureReview)
          .values({ userId, thoughtId: t.id, ...rows[i] })
          .returning({ id: captureReview.id })
        ids.push(t.id, r.id)
      }
    })

    after = await loadCaptureQuality({ includeHarness: true })
    afterProd = await loadCaptureQuality({ includeHarness: false })
  })

  afterAll(async () => {
    await withOperatorDb(async (db) => {
      await db.delete(user).where(eq(user.id, userId))
    }).catch(() => undefined)
  })

  it('counts the totals', () => {
    const d = delta(after, before) as Loaded
    expect(d.totals).toEqual({
      reviews: 7,
      status: { pending_audit: 1, scored: 5, audit_failed: 1 },
      scoredBelowThreshold: 3,
      scoredAtOrAboveThreshold: 2,
      votes: {
        capture: { up: 2, down: 1 },
        mesh: { up: 0, down: 1 },
        mcp: { up: 0, down: 1 },
      },
      votesWithoutScore: 1,
      downWithoutReason: 1,
    })
  })

  it('puts a stored real 0.7 at or above the threshold and in band 0_7_to_0_9', () => {
    const d = delta(after, before) as Loaded
    expect(d.totals.scoredAtOrAboveThreshold).toBe(2)
    expect(d.scoreBands['0_7_to_0_9']).toEqual(band(1, 1, 1, 0))
    expect(d.scoreBands.lt_0_5).toEqual(band(2, 2, 0, 2))
    expect(d.scoreBands['0_5_to_0_7']).toEqual(band(1, 1, 0, 1))
    expect(d.scoreBands.gte_0_9).toEqual(band(1, 0, 0, 0))
  })

  it('counts a tie for weakest for both kinds, and bands several names by the weakest', () => {
    const d = delta(after, before) as Loaded
    expect(d.parts.wording.weakest).toBe(1)
    expect(d.parts.date.weakest).toBe(1)
    expect(d.parts.category.weakest).toBe(3)
    expect(d.parts.name.weakest).toBe(1)
    // R1 name 0.8, R3 names 0.5 and 0.9: R3 counts once, in 0_5_to_0_7
    expect(d.parts.name.bands['0_7_to_0_9']).toEqual(band(1, 1, 1, 0))
    expect(d.parts.name.bands['0_5_to_0_7']).toEqual(band(1, 1, 0, 1))
    expect(d.parts.name.bands.gte_0_9).toEqual(band(0, 0, 0, 0))
    expect(d.parts.category.bands).toEqual({
      lt_0_5: band(1, 1, 0, 1),
      '0_5_to_0_7': band(0, 0, 0, 0),
      '0_7_to_0_9': band(1, 1, 1, 0),
      gte_0_9: band(3, 2, 0, 2),
    })
  })

  it('never counts an unscored kind as weakest, but still bands it', () => {
    const d = delta(after, before) as Loaded
    expect(after.parts.entity_type.scored).toBe(false)
    expect(after.parts.category.scored).toBe(true)
    expect(d.parts.entity_type.weakest).toBe(0)
    expect(d.parts.entity_type.bands.lt_0_5).toEqual(band(1, 1, 0, 1))
    expect(d.parts.piece.weakest).toBe(0)
  })

  it('counts the reason kinds, zero-filled', () => {
    const d = delta(after, before) as Loaded
    expect(d.reasonKinds.wrong_date).toBe(1)
    expect(d.reasonKinds.wrong_name).toBe(1)
    expect(d.reasonKinds.other).toBe(0)
    expect(Object.keys(after.reasonKinds)).toHaveLength(9)
  })

  it('shows no change when harness accounts are excluded', () => {
    expect(delta(afterProd, beforeProd)).toEqual(delta(beforeProd, beforeProd))
    expect((delta(afterProd, beforeProd) as Loaded).totals.reviews).toBe(0)
  })

  it('holds no text, user id, thought id or review id', () => {
    const json = JSON.stringify(after) + JSON.stringify(afterProd)
    for (const secret of [...texts, ...ids, suffix]) expect(json).not.toContain(secret)
  })

  it('reports the threshold', () => {
    expect(after.threshold).toBe(0.7)
  })
})

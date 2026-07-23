import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { thought } from '$lib/server/db/brain.schema'
import { user } from '$lib/server/db/auth.schema'
import { retrievalQualityEvent } from '$lib/server/db/schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { recordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry'

const embeddingVec = () => Array.from({ length: 1536 }, () => 0.02)

vi.mock('$lib/server/llm/embedding', () => ({
  createThoughtEmbedding: vi.fn().mockResolvedValue(embeddingVec()),
}))

vi.mock('$lib/server/graph/age', () => ({
  expandNeighborsByIds: vi.fn().mockResolvedValue([]),
  expandThoughtIdsFromEntitySeeds: vi.fn().mockResolvedValue([]),
}))

vi.mock('$lib/server/memory/entity-resolution', () => ({
  matchCanonicalEntitiesByEmbedding: vi.fn().mockResolvedValue([]),
}))

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('retrieval RLS + quality telemetry integration', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb
  let searchThoughts: typeof import('$lib/server/retrieval/service').searchThoughts

  const suffix = `it_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
  const ua = `rls_ua_${suffix}`
  const ub = `rls_ub_${suffix}`
  const secretToken = `secret_ub_token_${suffix}`

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb
    ;({ searchThoughts } = await import('$lib/server/retrieval/service'))

    // Identity rows once per run — user inserts are operator operations (FORCE RLS on `user`).
    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: ua,
        name: 'RLS A',
        email: `${ua}@test.local`,
        emailVerified: true,
        onboardingCompleted: true,
      })
      await db.insert(user).values({
        id: ub,
        name: 'RLS B',
        email: `${ub}@test.local`,
        emailVerified: true,
        onboardingCompleted: true,
      })
    })

    // thought_user_category_ontology_fk requires a seeded ontology per user.
    const { ensureUserOntologySeeded } = await import('$lib/server/ontology-db')
    await withEvalDb(ua, async (db) => ensureUserOntologySeeded(db, ua))
    await withEvalDb(ub, async (db) => ensureUserOntologySeeded(db, ub))
  })

  afterAll(async () => {
    for (const uid of [ua, ub]) {
      await withOperatorDb(async (db) => {
        await db.delete(user).where(eq(user.id, uid))
      }).catch(() => undefined)
    }
  })

  it('searchThoughts does not return other tenants thoughts under RLS', async () => {
    const ubThoughtId = await withEvalDb(ub, async (db) => {
      const norm = `${secretToken} unique line`
      const [row] = await db
        .insert(thought)
        .values({
          userId: ub,
          rawText: norm,
          normalizedText: norm,
          lexicalText: computeLexicalText(norm),
          category: 'observation',
          metadata: {},
          embedding: embeddingVec(),
        })
        .returning({ id: thought.id })
      return row.id
    })

    const results = await withEvalDb(ua, async () =>
      searchThoughts({
        userId: ua,
        query: secretToken,
        topK: 10,
      }),
    )

    expect(results.some((r) => r.id === ubThoughtId)).toBe(false)
  })

  it('searchThoughts excludes completed and archived lifecycle thoughts', async () => {
    const token = `lifecycle_filter_${suffix}`
    const thoughtIds = await withEvalDb(ua, async (db) => {
      const norm = `${token} shared phrase`
      const base = {
        userId: ua,
        rawText: norm,
        normalizedText: norm,
        lexicalText: computeLexicalText(norm),
        category: 'task' as const,
        metadata: {},
        embedding: embeddingVec(),
      }
      const [openRow] = await db
        .insert(thought)
        .values({ ...base, lifecycleStatus: 'open' })
        .returning({ id: thought.id })
      const [completedRow] = await db
        .insert(thought)
        .values({ ...base, lifecycleStatus: 'completed' })
        .returning({ id: thought.id })
      const [archivedRow] = await db
        .insert(thought)
        .values({ ...base, lifecycleStatus: 'archived' })
        .returning({ id: thought.id })
      return {
        openId: openRow.id,
        completedId: completedRow.id,
        archivedId: archivedRow.id,
      }
    })

    const results = await withEvalDb(ua, async () =>
      searchThoughts({
        userId: ua,
        query: token,
        topK: 10,
      }),
    )

    const ids = new Set(results.map((r) => r.id))
    expect(ids.has(thoughtIds.openId)).toBe(true)
    expect(ids.has(thoughtIds.completedId)).toBe(false)
    expect(ids.has(thoughtIds.archivedId)).toBe(false)
  })

  it('retrieval_quality_event rows are tenant-scoped under RLS', async () => {
    await withEvalDb(ua, async (db) => {
      await recordRetrievalQualityEvent(db, {
        userId: ua,
        surface: 'api',
        weights: { vector: 0.7, graph: 0.3 },
        topKRequested: 5,
        results: [
          { vectorScore: 0.05, graphScore: 0.01 },
          { vectorScore: 0.02, graphScore: 0.02 },
        ],
      })
    })

    const uaVisible = await withEvalDb(ua, async (db) =>
      db.select({ id: retrievalQualityEvent.id }).from(retrievalQualityEvent),
    )
    expect(uaVisible.length).toBeGreaterThanOrEqual(1)

    const ubVisible = await withEvalDb(ub, async (db) =>
      db.select({ id: retrievalQualityEvent.id }).from(retrievalQualityEvent),
    )
    expect(ubVisible).toHaveLength(0)
  })
})

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { thought } from '$lib/server/db/brain.schema'
import { user } from '$lib/server/db/auth.schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'

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

describe.skipIf(!hasDb)('activeThoughtLifecycleCondition metadata guard', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb
  let listThoughts: typeof import('$lib/server/capture/service').listThoughts

  const suffix = `lifecycle_meta_${Date.now().toString(36)}`
  const userId = `lc_meta_${suffix}`

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb
    ;({ listThoughts } = await import('$lib/server/capture/service'))

    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: userId,
        name: 'Lifecycle Meta',
        email: `${userId}@lifecycle.test`,
        emailVerified: true,
        onboardingCompleted: true,
      })
    })

    // thought_user_category_ontology_fk requires a seeded ontology for the user.
    const { ensureUserOntologySeeded } = await import('$lib/server/ontology-db')
    await withEvalDb(userId, async (db) => ensureUserOntologySeeded(db, userId))
  })

  afterAll(async () => {
    await withOperatorDb(async (db) => {
      await db.delete(user).where(eq(user.id, userId))
    }).catch(() => undefined)
  })

  it('listThoughts excludes plaintext metadata completed drift when lifecycle_status is open', async () => {
    const token = `meta_drift_${suffix}`
    await withEvalDb(userId, async (db) => {
      const norm = `${token} visible open thought`
      await db.insert(thought).values({
        userId,
        rawText: norm,
        normalizedText: norm,
        lexicalText: computeLexicalText(norm),
        category: 'task',
        metadata: { status: 'open' },
        lifecycleStatus: 'open',
        embedding: embeddingVec(),
      })
      const driftNorm = `${token} metadata completed drift`
      await db.insert(thought).values({
        userId,
        rawText: driftNorm,
        normalizedText: driftNorm,
        lexicalText: computeLexicalText(driftNorm),
        category: 'task',
        metadata: { status: 'completed' },
        lifecycleStatus: 'open',
        embedding: embeddingVec(),
      })
    })

    const rows = await withEvalDb(userId, async () => listThoughts(userId, { limit: 20 }))
    const texts = rows.map((r) => r.normalizedText)
    expect(texts.some((t) => t.includes('visible open thought'))).toBe(true)
    expect(texts.some((t) => t.includes('metadata completed drift'))).toBe(false)
  })
})

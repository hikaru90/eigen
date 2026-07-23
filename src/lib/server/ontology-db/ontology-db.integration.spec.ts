import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { user } from '$lib/server/db/auth.schema'
import {
  ontologyEntityKind,
  ontologyRelationKind,
  thought,
  thoughtRelation,
} from '$lib/server/db/schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import {
  deactivateEntityKindWithReconcile,
  deactivateRelationKindWithReconcile,
  ensureUserOntologySeeded,
  loadOntologyForUser,
  pruneUnusedOntologyEntityKinds,
  seedDefaultPracticalOntology,
  validateEntityKindKeyForNewIngest,
} from '$lib/server/ontology-db'

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('ontology-db integration (RLS)', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb

  const suffix = `onto_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
  const ua = `onto_ua_${suffix}`
  const ub = `onto_ub_${suffix}`

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb
  })

  const uidRel = `onto_rel_${suffix}`
  const uidEnt = `onto_ent_${suffix}`
  const uidPrune = `onto_prune_${suffix}`

  afterAll(async () => {
    for (const uid of [ua, ub, uidRel, uidEnt, uidPrune]) {
      await withOperatorDb(async (db) => {
        await db.delete(user).where(eq(user.id, uid))
      }).catch(() => undefined)
    }
  })

  it('seeds default practical ontology once per user and isolates tenants', async () => {
    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: ua,
        name: 'Onto A',
        email: `${ua}@test.local`,
        emailVerified: true,
        onboardingCompleted: true,
      })
    })
    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: ub,
        name: 'Onto B',
        email: `${ub}@test.local`,
        emailVerified: true,
        onboardingCompleted: true,
      })
    })

    await withEvalDb(ua, async (db) => {
      await ensureUserOntologySeeded(db, ua)
      const a = await loadOntologyForUser(db, ua)
      // 10 thought_category kinds + 8 entity_type kinds = 18
      expect(a.entityKinds.length).toBe(18)
      expect(a.relationKinds.length).toBe(10)
      expect(validateEntityKindKeyForNewIngest(a, 'task')).toBe(true)
    })

    await withEvalDb(ub, async (db) => {
      await seedDefaultPracticalOntology(db, ub)
      const b = await loadOntologyForUser(db, ub)
      expect(b.entityKindsByKey.get('task')?.id).toBeDefined()
    })

    let taskIdA = ''
    let taskIdB = ''
    await withEvalDb(ua, async (db) => {
      const a = await loadOntologyForUser(db, ua)
      taskIdA = a.entityKindsByKey.get('task')!.id
    })
    await withEvalDb(ub, async (db) => {
      const b = await loadOntologyForUser(db, ub)
      taskIdB = b.entityKindsByKey.get('task')!.id
    })
    expect(taskIdA).not.toBe(taskIdB)
  })

  it('deactivateRelationKindWithReconcile clears thought_relation ontology FK', async () => {
    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: uidRel,
        name: 'Rel',
        email: `${uidRel}@test.local`,
        emailVerified: true,
        onboardingCompleted: true,
      })
    })

    await withEvalDb(uidRel, async (db) => {
      await ensureUserOntologySeeded(db, uidRel)
      const loaded = await loadOntologyForUser(db, uidRel)
      const relRow = loaded.relationKindsByKey.get('leads_to')
      expect(relRow).toBeDefined()

      const t1 = crypto.randomUUID()
      const t2 = crypto.randomUUID()
      const norm = 'hello ontology reconcile'
      await db.insert(thought).values([
        {
          id: t1,
          userId: uidRel,
          rawText: norm,
          normalizedText: norm,
          lexicalText: computeLexicalText(norm),
          category: 'task',
          metadata: {},
        },
        {
          id: t2,
          userId: uidRel,
          rawText: norm + ' b',
          normalizedText: norm + ' b',
          lexicalText: computeLexicalText(norm + ' b'),
          category: 'task',
          metadata: {},
        },
      ])

      await db.insert(thoughtRelation).values({
        userId: uidRel,
        sourceThoughtId: t1,
        targetThoughtId: t2,
        relationType: 'related_to',
        ontologyRelationKindId: relRow!.id,
      })

      await deactivateRelationKindWithReconcile(db, uidRel, relRow!.id)

      const [edge] = await db
        .select({ ontologyRelationKindId: thoughtRelation.ontologyRelationKindId })
        .from(thoughtRelation)
        .where(
          and(eq(thoughtRelation.sourceThoughtId, t1), eq(thoughtRelation.targetThoughtId, t2)),
        )
      expect(edge?.ontologyRelationKindId).toBeNull()

      const [rk] = await db
        .select({ active: ontologyRelationKind.active })
        .from(ontologyRelationKind)
        .where(eq(ontologyRelationKind.id, relRow!.id))
      expect(rk?.active).toBe(false)
    })
  })

  it('deactivateEntityKindWithReconcile clears thought FK and deactivates touching relation kinds', async () => {
    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: uidEnt,
        name: 'Ent',
        email: `${uidEnt}@test.local`,
        emailVerified: true,
        onboardingCompleted: true,
      })
    })

    await withEvalDb(uidEnt, async (db) => {
      await ensureUserOntologySeeded(db, uidEnt)
      const loaded = await loadOntologyForUser(db, uidEnt)
      const taskKind = loaded.entityKindsByKey.get('task')
      expect(taskKind).toBeDefined()

      const norm = 'task kind row'
      const [th] = await db
        .insert(thought)
        .values({
          userId: uidEnt,
          rawText: norm,
          normalizedText: norm,
          lexicalText: computeLexicalText(norm),
          category: 'task',
          metadata: {},
          ontologyEntityKindId: taskKind!.id,
        })
        .returning({ id: thought.id })

      await deactivateEntityKindWithReconcile(db, uidEnt, taskKind!.id)

      const [tRow] = await db
        .select({ oid: thought.ontologyEntityKindId })
        .from(thought)
        .where(eq(thought.id, th!.id))
      expect(tRow?.oid).toBeNull()

      const [ek] = await db
        .select({ active: ontologyEntityKind.active })
        .from(ontologyEntityKind)
        .where(eq(ontologyEntityKind.id, taskKind!.id))
      expect(ek?.active).toBe(false)

      // 'leads_to' and 'motivates' both point to 'task' — both should be deactivated
      const leadsTo = loaded.relationKindsByKey.get('leads_to')
      expect(leadsTo).toBeDefined()
      const [rk] = await db
        .select({ active: ontologyRelationKind.active })
        .from(ontologyRelationKind)
        .where(eq(ontologyRelationKind.id, leadsTo!.id))
      expect(rk?.active).toBe(false)
    })
  })

  it('pruneUnusedOntologyEntityKinds deletes custom kinds with no thought refs and touching relations', async () => {
    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: uidPrune,
        name: 'Prune',
        email: `${uidPrune}@test.local`,
        emailVerified: true,
        onboardingCompleted: true,
      })
    })

    await withEvalDb(uidPrune, async (db) => {
      await ensureUserOntologySeeded(db, uidPrune)
      const loaded = await loadOntologyForUser(db, uidPrune)
      const taskId = loaded.entityKindsByKey.get('task')!.id

      const [junk] = await db
        .insert(ontologyEntityKind)
        .values({
          userId: uidPrune,
          key: 'junk_kind',
          name: 'Junk',
          definition: 'unused test kind',
          active: true,
        })
        .returning({ id: ontologyEntityKind.id })

      await db.insert(ontologyRelationKind).values({
        userId: uidPrune,
        key: 'junk_link',
        meaning: 'test',
        fromOntologyEntityKindId: taskId,
        toOntologyEntityKindId: junk!.id,
        active: true,
      })

      // 18 default kinds + 1 junk = 19
      expect((await loadOntologyForUser(db, uidPrune)).entityKinds.length).toBe(19)

      const pruned = await pruneUnusedOntologyEntityKinds(db, uidPrune)
      expect(pruned.deletedEntityKindIds).toEqual([junk!.id])
      expect(pruned.deletedRelationKindIds.length).toBe(1)

      const after = await loadOntologyForUser(db, uidPrune)
      // 18 default kinds remain
      expect(after.entityKinds.length).toBe(18)
      expect(after.entityKindsByKey.get('junk_kind')).toBeUndefined()
      expect(after.relationKindsByKey.get('junk_link')).toBeUndefined()
      expect(after.entityKindsByKey.get('task')).toBeDefined()
    })
  })
})

import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { user } from '$lib/server/db/auth.schema'
import { ontologyEntityKind } from '$lib/server/db/schema'
import {
  DEFAULT_ALL_ONTOLOGY_KIND_KEYS,
  DEFAULT_ENTITY_TYPE_KIND_KEYS,
  DEFAULT_THOUGHT_CATEGORY_KINDS,
  DEFAULT_THOUGHT_CATEGORY_KIND_KEYS,
  ensureUserOntologySeeded,
  seedDefaultPracticalOntology,
} from './seed-default-cognitive'

/** Definition shipped before completed-action reports got their own category. */
const LEGACY_TASK_DEFINITION = 'Something to do, an action item, or work in progress'

describe('baseline thought category kinds (completed-action coverage)', () => {
  it('has a dedicated category for reports of completed actions', () => {
    const action = DEFAULT_THOUGHT_CATEGORY_KINDS.find((k) => k.key === 'action')
    expect(action, 'an "action" thought category kind must exist').toBeDefined()
    expect(action?.name).toBe('Action')
    // Covers completed actions / status updates — the "I just enabled X" class.
    expect(action?.definition.toLowerCase()).toMatch(/done|happened|completed/)
    expect(action?.definition.toLowerCase()).toMatch(/status update|occurrence|report/)
  })

  it('restricts task to work that is not yet done', () => {
    const task = DEFAULT_THOUGHT_CATEGORY_KINDS.find((k) => k.key === 'task')
    expect(task).toBeDefined()
    expect(task?.definition.toLowerCase()).toMatch(/not yet|not.*done/)
    // Explicitly excludes completed work so action reports cannot land here.
    expect(task?.definition.toLowerCase()).toMatch(/completed|already/)
    expect(task?.definition).not.toBe(LEGACY_TASK_DEFINITION)
  })

  it('never reuses a key across kind types ((user_id, key) is globally unique)', () => {
    const shared = DEFAULT_THOUGHT_CATEGORY_KIND_KEYS.filter((k) =>
      DEFAULT_ENTITY_TYPE_KIND_KEYS.includes(k),
    )
    expect(shared, `keys shared with entity types: ${shared.join(', ')}`).toEqual([])
  })

  it('protects the action kind from ontology prune', () => {
    expect(DEFAULT_ALL_ONTOLOGY_KIND_KEYS).toContain('action')
  })
})

const hasDb = Boolean(process.env.DATABASE_URL)

describe.skipIf(!hasDb)('baseline ontology sync for existing users', () => {
  const suffix = `seeddef_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
  const uid = `seeddef_u_${suffix}`

  afterAll(async () => {
    const { withOperatorDb } = await import('../../../../evals/harness/eval-context')
    await withOperatorDb(async (db) => {
      await db.delete(user).where(eq(user.id, uid))
    }).catch(() => undefined)
  })

  it('inserts missing kinds, refreshes stale definitions, and preserves active flags', async () => {
    const { withOperatorDb } = await import('../../../../evals/harness/eval-context')
    await withOperatorDb(async (db) => {
      await db.insert(user).values({
        id: uid,
        name: 'Seed Def',
        email: `${uid}@test.local`,
        emailVerified: true,
      })
      // Simulate a user seeded by the pre-fix code: legacy task definition,
      // no 'action' kind yet, and one kind the user deactivated.
      await seedDefaultPracticalOntology(db, uid)
      await db
        .update(ontologyEntityKind)
        .set({ definition: LEGACY_TASK_DEFINITION })
        .where(
          and(
            eq(ontologyEntityKind.userId, uid),
            eq(ontologyEntityKind.key, 'task'),
            eq(ontologyEntityKind.kindType, 'thought_category'),
          ),
        )
      await db
        .delete(ontologyEntityKind)
        .where(and(eq(ontologyEntityKind.userId, uid), eq(ontologyEntityKind.key, 'action')))
      await db
        .update(ontologyEntityKind)
        .set({ active: false })
        .where(
          and(
            eq(ontologyEntityKind.userId, uid),
            eq(ontologyEntityKind.key, 'idea'),
            eq(ontologyEntityKind.kindType, 'thought_category'),
          ),
        )

      await ensureUserOntologySeeded(db, uid)

      const rows = await db
        .select()
        .from(ontologyEntityKind)
        .where(
          and(
            eq(ontologyEntityKind.userId, uid),
            eq(ontologyEntityKind.kindType, 'thought_category'),
          ),
        )
      const byKey = new Map(rows.map((r) => [r.key, r]))

      const action = byKey.get('action')
      expect(action, 'missing baseline kind must be inserted for existing users').toBeDefined()
      expect(action?.definition.toLowerCase()).toMatch(/done|happened|completed/)

      const task = byKey.get('task')
      expect(task?.definition).not.toBe(LEGACY_TASK_DEFINITION)
      expect(task?.definition).toMatch(/not yet|not.*done/)

      // User deactivation must survive the sync — sync touches name/definition only.
      expect(byKey.get('idea')?.active).toBe(false)
    })
  })

  it('is idempotent — a second sync run changes nothing further', async () => {
    const { withOperatorDb } = await import('../../../../evals/harness/eval-context')
    await withOperatorDb(async (db) => {
      await ensureUserOntologySeeded(db, uid)
      const [task] = await db
        .select({ definition: ontologyEntityKind.definition, updatedAt: ontologyEntityKind.updatedAt })
        .from(ontologyEntityKind)
        .where(
          and(
            eq(ontologyEntityKind.userId, uid),
            eq(ontologyEntityKind.key, 'task'),
            eq(ontologyEntityKind.kindType, 'thought_category'),
          ),
        )
      expect(task?.definition).toMatch(/not yet|not.*done/)
    })
  })
})

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { user } from '$lib/server/db/auth.schema'
import { thought } from '$lib/server/db/brain.schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'

const hasDb = Boolean(process.env.DATABASE_URL)

/**
 * Suggested questions on Ask against a real database: the migration applied, the
 * question is stored encrypted, the loader runs under RLS, archived thoughts and other
 * tenants never leak in, and a re-enrich rewrite replaces the old question.
 */
describe.skipIf(!hasDb)('Ask suggested questions integration (RLS + at-rest encryption)', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb
  let loadAskSuggestions: typeof import('./ask-suggestions').loadAskSuggestions
  let askQuestionColumns: typeof import('$lib/server/capture/ask-question-store').askQuestionColumns

  const suffix = `askq_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
  const ua = `askq_ua_${suffix}`
  const ub = `askq_ub_${suffix}`

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb
    ;({ loadAskSuggestions } = await import('./ask-suggestions'))
    ;({ askQuestionColumns } = await import('$lib/server/capture/ask-question-store'))
    await withOperatorDb(async (db) => {
      for (const id of [ua, ub]) {
        await db.insert(user).values({
          id,
          name: id,
          email: `${id}@test.local`,
          emailVerified: true,
          onboardingCompleted: true,
        })
      }
    })
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

  async function insertThought(
    userId: string,
    text: string,
    question: string | null,
    opts: { minutesAgo: number; lifecycleStatus?: 'open' | 'archived' },
  ): Promise<string> {
    return withEvalDb(userId, async (db) => {
      const cols = await askQuestionColumns(userId, question)
      const createdAt = new Date(Date.now() - opts.minutesAgo * 60_000)
      const [row] = await db
        .insert(thought)
        .values({
          userId,
          rawText: text,
          normalizedText: text,
          lexicalText: computeLexicalText(text),
          category: 'observation',
          metadata: {},
          lifecycleStatus: opts.lifecycleStatus ?? 'open',
          createdAt,
          updatedAt: createdAt,
          ...cols,
        })
        .returning({ id: thought.id })
      return row.id
    })
  }

  it('returns the 3 newest open questions for the tenant only, encrypted at rest', async () => {
    await insertThought(ua, 'oldest', 'What was the oldest note?', { minutesAgo: 50 })
    const plumber = await insertThought(ua, 'Call the plumber about the kitchen sink', 'What did I need to call the plumber about?', { minutesAgo: 40 })
    await insertThought(ua, 'hi', null, { minutesAgo: 30 })
    await insertThought(ua, 'archived thing', 'What did I archive?', { minutesAgo: 20, lifecycleStatus: 'archived' })
    await insertThought(ua, 'dentist friday', 'When is my dentist appointment?', { minutesAgo: 10 })
    await insertThought(ua, 'offsite lisbon', 'Where is the team offsite?', { minutesAgo: 5 })
    await insertThought(ub, 'other tenant', 'What is the other tenant hiding?', { minutesAgo: 1 })

    const out = await withEvalDb(ua, async () => loadAskSuggestions(ua))
    expect(out.map((s) => s.question)).toEqual([
      'Where is the team offsite?',
      'When is my dentist appointment?',
      'What did I need to call the plumber about?',
    ])
    expect(out[2]?.thoughtId).toBe(plumber)

    const [stored] = await withEvalDb(ua, async (db) =>
      db
        .select({ enc: thought.askQuestionEncrypted })
        .from(thought)
        .where(eq(thought.id, plumber)),
    )
    expect(stored?.enc).toBeTruthy()
    expect(stored?.enc).not.toContain('plumber')
  })

  it('a re-enrich rewrite replaces the question; forgetting removes it (AC-5)', async () => {
    const id = await insertThought(ua, 'newest note', 'What was the newest note?', { minutesAgo: 0 })
    await withEvalDb(ua, async (db) => {
      await db
        .update(thought)
        .set(await askQuestionColumns(ua, 'What did I change in the newest note?'))
        .where(eq(thought.id, id))
    })
    let out = await withEvalDb(ua, async () => loadAskSuggestions(ua))
    expect(out[0]).toEqual({ thoughtId: id, question: 'What did I change in the newest note?' })

    await withEvalDb(ua, async (db) => {
      await db.delete(thought).where(eq(thought.id, id))
    })
    out = await withEvalDb(ua, async () => loadAskSuggestions(ua))
    expect(out.some((s) => s.thoughtId === id)).toBe(false)
  })

  it('the migration added both columns', async () => {
    const rows = await withOperatorDb(async (db) =>
      db.execute(
        sql`select column_name from information_schema.columns where table_name = 'thought' and column_name in ('ask_question', 'ask_question_encrypted') order by column_name`,
      ),
    )
    expect(Array.from(rows as Iterable<{ column_name: string }>).map((r) => r.column_name)).toEqual([
      'ask_question',
      'ask_question_encrypted',
    ])
  })
})

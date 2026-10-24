import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { user } from '$lib/server/db/auth.schema'
import { boardIdea, boardVote } from '$lib/server/db/brain.schema'
import { rowsFromDbExecute } from '$lib/server/db/execute-rows'

/**
 * Multiplayer board against the real database with RLS on (SET ROLE eigen_app +
 * app.current_user_id). Covers AC-1…AC-10 and AC-14 across real tenant sessions.
 */
const hasDb = Boolean(process.env.DATABASE_URL)

function vec(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(seed * 31 + i) / 10)
}

describe.skipIf(!hasDb)('board RLS integration', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb
  let svc: typeof import('./service')

  const suffix = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`
  const ua = `board_a_${suffix}`
  const ub = `board_b_${suffix}`
  const uc = `board_c_${suffix}`
  const admin = `board_admin_${suffix}`
  const created: string[] = []

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb
    svc = await import('./service')
    await withOperatorDb(async (db) => {
      await db.insert(user).values([
        {
          id: ua,
          name: 'Noor Khalil',
          firstName: 'Noor',
          lastName: 'Khalil',
          email: `${ua}@test.local`,
          emailVerified: true,
        },
        {
          id: ub,
          name: 'Elio Berg',
          firstName: 'Elio',
          lastName: 'Berg',
          email: `${ub}@test.local`,
          emailVerified: true,
        },
        {
          id: uc,
          name: 'Sana Ito',
          firstName: 'Sana',
          lastName: 'Ito',
          email: `${uc}@test.local`,
          emailVerified: true,
        },
        {
          id: admin,
          name: 'Max Maker',
          firstName: 'Max',
          lastName: 'Maker',
          email: `${admin}@test.local`,
          emailVerified: true,
          role: 'admin',
        },
      ])
    })
  })

  afterAll(async () => {
    await withOperatorDb(async (db) => {
      if (created.length) await db.delete(boardIdea).where(inArray(boardIdea.id, created))
      await db.delete(user).where(inArray(user.id, [ua, ub, uc, admin]))
    }).catch(() => undefined)
  })

  async function share(userId: string, title: string, seed: number): Promise<string> {
    const { ideaId } = await withEvalDb(userId, () =>
      svc.insertBoardIdea({ userId, title, kind: 'idea', area: 'yarn', embedding: vec(seed) }),
    )
    created.push(ideaId)
    return ideaId
  }

  const view = (userId: string, id: string) =>
    withEvalDb(userId, async () => (await svc.listBoardIdeas(userId)).find((i) => i.id === id))

  it('AC-1 / AC-14: B sees A’s idea as Requested, score 1, author "Noor K." — no email or id', async () => {
    const id = await share(ua, `Dark mode for Mesh ${suffix}`, 1)
    const forA = await view(ua, id)
    expect(forA).toMatchObject({ status: 'requested', score: 1, myVote: 1, own: true })
    expect(forA?.author).toEqual({ display: 'Noor K.', isYou: true })

    const forB = await view(ub, id)
    expect(forB).toMatchObject({ status: 'requested', score: 1, myVote: 0, own: false })
    expect(forB?.author).toEqual({ display: 'Noor K.', isYou: false })
    const serialized = JSON.stringify(forB)
    expect(serialized).not.toContain(ua)
    expect(serialized).not.toContain('@test.local')
    expect(serialized).not.toMatch(/embedding/i)
  })

  it('AC-2 / AC-3 / AC-4: votes persist, flip by 2 and toggle off', async () => {
    const id = await share(ua, `Offline capture ${suffix}`, 2)
    expect(await withEvalDb(ub, () => svc.setBoardVote(ub, id, 1))).toEqual({ score: 2, myVote: 1 })
    expect((await view(ua, id))?.score).toBe(2)
    expect((await view(ub, id))?.myVote).toBe(1)

    expect(await withEvalDb(ub, () => svc.setBoardVote(ub, id, -1))).toEqual({
      score: 0,
      myVote: -1,
    })
    expect(await withEvalDb(ub, () => svc.setBoardVote(ub, id, 0))).toEqual({ score: 1, myVote: 0 })
    expect((await view(ub, id))?.myVote).toBe(0)
  })

  it('D2: the author can take their own +1 back but cannot downvote their own idea', async () => {
    const id = await share(ua, `Own vote ${suffix}`, 3)
    expect(await withEvalDb(ua, () => svc.setBoardVote(ua, id, 0))).toEqual({ score: 0, myVote: 0 })
    await expect(withEvalDb(ua, () => svc.setBoardVote(ua, id, -1))).rejects.toMatchObject({
      status: 409,
    })
  })

  it('AC-5: no budget — 30 votes are all accepted', async () => {
    const ids: string[] = []
    for (let k = 0; k < 30; k++) ids.push(await share(ua, `Bulk ${k} ${suffix}`, 100 + k))
    await withEvalDb(uc, async () => {
      for (const id of ids) expect((await svc.setBoardVote(uc, id, 1)).myVote).toBe(1)
    })
  })

  it('AC-6 / AC-7 / AC-10: makers move status; shipped is not votable; hidden disappears for non-admins', async () => {
    const id = await share(ua, `Shipping soon ${suffix}`, 4)
    await expect(
      withEvalDb(ub, () => svc.adminUpdateBoardIdea(ub, id, { status: 'shipped' })),
    ).rejects.toMatchObject({ status: 403 })

    await withEvalDb(admin, () =>
      svc.adminUpdateBoardIdea(admin, id, { status: 'shipped', note: 'Out now.' }),
    )
    const shipped = await view(ub, id)
    expect(shipped).toMatchObject({ status: 'shipped', note: 'Out now.' })
    expect(shipped?.shippedAt).toBeTruthy()

    await expect(withEvalDb(ub, () => svc.setBoardVote(ub, id, 1))).rejects.toMatchObject({
      status: 409,
    })
    expect((await view(ub, id))?.score).toBe(1)

    await withEvalDb(admin, () => svc.adminUpdateBoardIdea(admin, id, { hidden: true }))
    expect(await view(ub, id)).toBeUndefined()
    await expect(withEvalDb(ub, () => svc.setBoardVote(ub, id, 1))).rejects.toMatchObject({
      status: 404,
    })
  })

  it('rejected ideas vanish from the board for everyone (admin included) and can be restored', async () => {
    const id = await share(ua, `Not for us ${suffix}`, 7)
    await expect(
      withEvalDb(ub, () => svc.adminUpdateBoardIdea(ub, id, { status: 'rejected' })),
    ).rejects.toMatchObject({ status: 403 })
    await withEvalDb(admin, () => svc.adminUpdateBoardIdea(admin, id, { status: 'rejected' }))
    expect(await view(ub, id)).toBeUndefined()
    expect(await view(ua, id)).toBeUndefined()
    expect(await view(admin, id)).toBeUndefined()
    await expect(withEvalDb(ub, () => svc.setBoardVote(ub, id, 1))).rejects.toMatchObject({
      status: 404,
    })
    await withEvalDb(admin, () => svc.adminUpdateBoardIdea(admin, id, { status: 'requested' }))
    expect((await view(ub, id))?.status).toBe('requested')
  })

  it('protected columns cannot be changed by the author directly, even under their own policy', async () => {
    const id = await share(ua, `Sneaky ${suffix}`, 5)
    await expect(
      withEvalDb(ua, (db) =>
        db.update(boardIdea).set({ status: 'shipped' }).where(eq(boardIdea.id, id)),
      ),
    ).rejects.toThrow()
    await expect(
      withEvalDb(ub, () => svc.correctBoardIdea(ub, id, { kind: 'bug' })),
    ).rejects.toMatchObject({ status: 403 })
    await withEvalDb(ua, () => svc.correctBoardIdea(ua, id, { kind: 'bug', area: 'capture' }))
    expect(await view(ub, id)).toMatchObject({ kind: 'bug', area: 'capture' })
  })

  it('AC-8: the author forgets a Requested idea — gone for everyone with its votes; In progress is 409', async () => {
    const id = await share(ua, `Forget me ${suffix}`, 6)
    await withEvalDb(ub, () => svc.setBoardVote(ub, id, 1))
    await expect(withEvalDb(ub, () => svc.deleteBoardIdea(ub, id))).rejects.toMatchObject({
      status: 403,
    })
    await withEvalDb(ua, () => svc.deleteBoardIdea(ua, id))
    expect(await view(ub, id)).toBeUndefined()
    const votes = await withOperatorDb((db) =>
      db.select().from(boardVote).where(eq(boardVote.ideaId, id)),
    )
    expect(votes).toHaveLength(0)

    const loom = await share(ua, `On the loom ${suffix}`, 7)
    await withEvalDb(admin, () => svc.adminUpdateBoardIdea(admin, loom, { status: 'in-progress' }))
    await expect(withEvalDb(ua, () => svc.deleteBoardIdea(ua, loom))).rejects.toMatchObject({
      status: 409,
    })
    await expect(
      withEvalDb(ua, () => svc.correctBoardIdea(ua, loom, { kind: 'bug' })),
    ).rejects.toMatchObject({
      status: 409,
    })
  })

  it('AC-9: C querying board_vote directly sees only C’s own rows', async () => {
    const id = await share(ua, `Votes are private ${suffix}`, 8)
    await withEvalDb(ub, () => svc.setBoardVote(ub, id, -1))
    await withEvalDb(uc, () => svc.setBoardVote(uc, id, 1))
    const rows = await withEvalDb(uc, (db) => db.select().from(boardVote))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.userId === uc)).toBe(true)
    const raw = await withEvalDb(uc, (db) =>
      db.execute(sql`select user_id from board_vote where idea_id = ${id}`),
    )
    expect(rowsFromDbExecute<{ user_id: string }>(raw).map((r) => r.user_id)).toEqual([uc])
    // and nobody can write a vote in someone else's name
    await expect(
      withEvalDb(uc, (db) => db.insert(boardVote).values({ ideaId: id, userId: ub, direction: 1 })),
    ).rejects.toThrow()
  })

  it('a session without app.current_user_id sees no ideas and no scores', async () => {
    await share(ua, `Anonymous ${suffix}`, 9)
    const ideas = await withEvalDb('', (db) => db.select({ id: boardIdea.id }).from(boardIdea))
    expect(ideas).toHaveLength(0)
    const scores = await withEvalDb('', (db) => db.execute(sql`select * from board_scores()`))
    expect(rowsFromDbExecute(scores)).toHaveLength(0)
  })

  it('duplicate candidates rank by title embedding and exclude shipped ideas', async () => {
    const near = await share(ua, `Candidate near ${suffix}`, 42)
    const cands = await withEvalDb(ub, () => svc.findDuplicateCandidates(vec(42), 5))
    expect(cands[0]?.id).toBe(near)
    expect(JSON.stringify(cands)).not.toMatch(/embedding/i)
  })
})

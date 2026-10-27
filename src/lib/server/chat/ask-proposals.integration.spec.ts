import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { user } from '$lib/server/db/auth.schema'

const hasDb = Boolean(process.env.DATABASE_URL)

/**
 * The Ask proposal guard against a real database (feature-ask-proposes-thoughts.md AP-4):
 * the proposal is a persisted propose_thoughts tool step, read back under RLS in the user
 * turn directly after it, superseded by the latest proposal, and closed by anything later.
 */
describe.skipIf(!hasDb)('Ask proposals integration (persisted proposal, RLS)', () => {
  let withEvalDb: typeof import('../../../../evals/harness/eval-context').withEvalDb
  let withOperatorDb: typeof import('../../../../evals/harness/eval-context').withOperatorDb
  let askTurn: typeof import('./run-ask-turn')
  let loadOpenProposal: typeof import('./ask-proposals').loadOpenProposal

  const suffix = `askp_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
  const ua = `askp_ua_${suffix}`
  const ub = `askp_ub_${suffix}`

  beforeAll(async () => {
    const ctx = await import('../../../../evals/harness/eval-context')
    withEvalDb = ctx.withEvalDb
    withOperatorDb = ctx.withOperatorDb
    askTurn = await import('./run-ask-turn')
    ;({ loadOpenProposal } = await import('./ask-proposals'))
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
  })

  afterAll(async () => {
    for (const uid of [ua, ub]) {
      await withOperatorDb(async (db) => {
        await db.delete(user).where(eq(user.id, uid))
      }).catch(() => undefined)
    }
  })

  /** One persisted Ask turn that ended in a proposal, exactly as the streaming route stores it. */
  async function proposalTurn(
    db: Parameters<typeof askTurn.beginAskTurn>[0],
    userId: string,
    sessionId: string,
    message: string,
    proposalId: string,
    thoughts: string[],
  ) {
    await askTurn.beginAskTurn(db, { userId, sessionId, message, bootstrap: false })
    await askTurn.persistStreamedAssistantTurn({
      db,
      sessionId,
      userId,
      responseText: 'I would store these in your mesh',
      intermediateSteps: [
        {
          content: JSON.stringify({ tool: 'propose_thoughts' }),
          metadata: { variant: 'tool_call', tool: 'propose_thoughts', arguments: { thoughts } },
        },
        {
          content: 'propose_thoughts',
          metadata: { variant: 'tool_executing', tool: 'propose_thoughts' },
        },
        {
          content: JSON.stringify({ proposalId, thoughts }),
          metadata: { variant: 'tool_result', tool: 'propose_thoughts', failed: false },
        },
      ],
    })
  }

  it('opens in the next user turn, is superseded by a newer proposal and closes a turn later', async () => {
    await withEvalDb(ua, async (db) => {
      const { sessionId } = await askTurn.getOrCreateSession(db, ua, null, 'default')

      // turn 1 proposes p1
      await proposalTurn(db, ua, sessionId, 'I started bouldering with Jonas', 'p1', [
        'Boulders with Jonas',
      ])
      // before the user replies, nothing is open (there is no reply to judge yet)
      expect(await loadOpenProposal(db, sessionId)).toBeNull()

      // turn 2: the reply — p1 is open
      await askTurn.beginAskTurn(db, {
        userId: ua,
        sessionId,
        message: 'make it Wednesdays',
        bootstrap: false,
      })
      expect(await loadOpenProposal(db, sessionId)).toEqual({
        proposalId: 'p1',
        thoughts: ['Boulders with Jonas'],
      })
      // the revise turn proposes p2, which supersedes p1
      await askTurn.persistStreamedAssistantTurn({
        db,
        sessionId,
        userId: ua,
        responseText: 'Updated',
        intermediateSteps: [
          {
            content: '{}',
            metadata: { variant: 'tool_call', tool: 'propose_thoughts', arguments: {} },
          },
          {
            content: JSON.stringify({
              proposalId: 'p2',
              thoughts: ['Boulders with Jonas on Wednesdays'],
            }),
            metadata: { variant: 'tool_result', tool: 'propose_thoughts', failed: false },
          },
        ],
      })

      // turn 3: "yes" confirms p2 only
      await askTurn.beginAskTurn(db, { userId: ua, sessionId, message: 'yes', bootstrap: false })
      expect(await loadOpenProposal(db, sessionId)).toEqual({
        proposalId: 'p2',
        thoughts: ['Boulders with Jonas on Wednesdays'],
      })
      await askTurn.persistStreamedAssistantTurn({
        db,
        sessionId,
        userId: ua,
        responseText: 'Stored',
        intermediateSteps: [],
      })

      // turn 4: anything later cannot reach the old proposal (AC-4)
      await askTurn.beginAskTurn(db, { userId: ua, sessionId, message: 'yes', bootstrap: false })
      expect(await loadOpenProposal(db, sessionId)).toBeNull()
    })
  })

  it('never reads another tenant’s proposal', async () => {
    const sessionId = await withEvalDb(ua, async (db) => {
      const { sessionId } = await askTurn.getOrCreateSession(db, ua, null, 'default')
      await proposalTurn(db, ua, sessionId, 'private', 'pa', ['A secret'])
      await askTurn.beginAskTurn(db, { userId: ua, sessionId, message: 'yes', bootstrap: false })
      return sessionId
    })
    await withEvalDb(ub, async (db) => {
      expect(await loadOpenProposal(db, sessionId)).toBeNull()
    })
  })
})

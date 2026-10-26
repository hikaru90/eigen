import { describe, expect, it } from 'vitest'
import { planFactRetirement } from './plan-fact-retirement'

const fact = (
  id: string,
  status: 'active' | 'superseded' | 'forgotten' = 'active',
  secureValueId: string | null = null,
  supersededBy: string | null = null,
) => ({ id, status, secureValueId, supersededBy })

const live = (factId: string) => ({ factId, live: true })
const dead = (factId: string) => ({ factId, live: false })

function planFactWithOnly(f: ReturnType<typeof fact>) {
  return planFactRetirement({
    facts: [f],
    sources: [dead(f.id)],
    supersededByCandidates: [],
    revive: false,
  })
}

describe('planFactRetirement', () => {
  it('retires a fact when none of its sources is live, and keeps one that still has a live source', () => {
    const plan = planFactRetirement({
      facts: [fact('a'), fact('b'), fact('c'), fact('d')],
      sources: [dead('a'), live('b'), dead('c'), live('c')],
      supersededByCandidates: [],
      revive: false,
    })
    // d has no source row at all: nothing it was derived from remains
    expect([...plan.retire].sort()).toEqual(['a', 'd'])
    expect(plan.revive).toEqual([])
  })

  it('leaves already-forgotten facts alone', () => {
    const plan = planFactWithOnly(fact('a', 'forgotten', 'sv1'))
    expect(plan.retire).toEqual([])
    expect(plan.secureValueIds).toEqual([])
  })

  it('retires a superseded fact too: history of a removed source is not kept', () => {
    const plan = planFactWithOnly(fact('a', 'superseded', null, 'newer'))
    expect(plan.retire).toEqual(['a'])
  })

  it('hands back the secure values of retired facts so the identifier goes with the fact', () => {
    const plan = planFactRetirement({
      facts: [fact('a', 'active', 'sv1'), fact('b', 'active', 'sv2')],
      sources: [dead('a'), live('b')],
      supersededByCandidates: [],
      revive: false,
    })
    expect(plan.retire).toEqual(['a'])
    expect(plan.secureValueIds).toEqual(['sv1'])
  })

  describe('revive (a source edit or archive, not a forget request)', () => {
    // N ("quit coffee") superseded X ("drinks three coffees a day"); N's only source is gone
    const base = {
      facts: [fact('N')],
      sources: [dead('N')],
      supersededByCandidates: [fact('X', 'superseded', null, 'N')],
    }

    it('reopens the fact the retired one had replaced', () => {
      const plan = planFactRetirement({ ...base, revive: true })
      expect(plan.retire).toEqual(['N'])
      expect(plan.revive).toEqual(['X'])
    })

    it('does not reopen it when asked not to (forget stays forgotten)', () => {
      const plan = planFactRetirement({ ...base, revive: false })
      expect(plan.revive).toEqual([])
    })

    it('does not reopen a fact that is itself being retired', () => {
      const plan = planFactRetirement({
        facts: [fact('N'), fact('X', 'superseded', null, 'N')],
        sources: [dead('N'), dead('X')],
        supersededByCandidates: [fact('X', 'superseded', null, 'N')],
        revive: true,
      })
      expect([...plan.retire].sort()).toEqual(['N', 'X'])
      expect(plan.revive).toEqual([])
    })

    it('only reopens facts that are still superseded by a retired one', () => {
      const plan = planFactRetirement({
        facts: [fact('N')],
        sources: [dead('N')],
        supersededByCandidates: [
          fact('X', 'superseded', null, 'N'),
          fact('Y', 'superseded', null, 'OTHER'),
          fact('Z', 'forgotten', null, 'N'),
        ],
        revive: true,
      })
      expect(plan.revive).toEqual(['X'])
    })
  })
})

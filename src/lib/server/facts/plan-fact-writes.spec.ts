import type { FactOperation, ParsedFact } from './fact-operations'
import { describe, expect, it } from 'vitest'
import { SECURE_VALUE_PLACEHOLDER, secureReferenceToken } from './fact-vocabulary'
import { planFactWrites } from './plan-fact-writes'

const FACT_ID = '11111111-1111-4111-8111-111111111111'
const SECURE_ID = '22222222-2222-4222-8222-222222222222'
const OLD_ID = '99999999-9999-4999-8999-999999999999'

function idSequence(...ids: string[]) {
  let i = 0
  return () => {
    const id = ids[i++]
    if (!id) throw new Error('ran out of ids')
    return id
  }
}

const swims: ParsedFact = {
  subject: { kind: 'user' },
  kind: 'activity',
  statement: 'Swims at the local pool',
  confidence: 0.92,
  inferred: false,
  identifier: null,
}

describe('planFactWrites', () => {
  it('plans an add with a fresh id and a folded keyword surface', () => {
    const plan = planFactWrites([{ op: 'add', fact: swims }], idSequence(FACT_ID))
    expect(plan.confirms).toEqual([])
    expect(plan.adds).toEqual([
      {
        id: FACT_ID,
        subject: { kind: 'user' },
        kind: 'activity',
        displayStatement: 'Swims at the local pool',
        storedStatement: 'Swims at the local pool',
        lexicalText: 'swims at the local pool',
        confidence: 0.92,
        inferred: false,
        secureValue: null,
        supersedesFactId: null,
      },
    ])
  })

  it('puts the person into the keyword surface so a name finds the fact even if the statement omits it', () => {
    const plan = planFactWrites(
      [
        {
          op: 'add',
          fact: {
            ...swims,
            subject: { kind: 'person', label: 'Mia (friend)', entityId: null },
            statement: 'Keeps getting headaches',
          },
        },
      ],
      idSequence(FACT_ID),
    )
    expect(plan.adds[0]!.lexicalText).toContain('mia')
    expect(plan.adds[0]!.lexicalText).toContain('headaches')
  })

  it('plans an update as an add that supersedes the stored fact', () => {
    const plan = planFactWrites(
      [{ op: 'update', supersedesFactId: OLD_ID, fact: { ...swims, statement: 'Quit coffee' } }],
      idSequence(FACT_ID),
    )
    expect(plan.adds).toHaveLength(1)
    expect(plan.adds[0]).toMatchObject({
      id: FACT_ID,
      supersedesFactId: OLD_ID,
      displayStatement: 'Quit coffee',
    })
  })

  it('plans confirms as stored-fact ids', () => {
    const plan = planFactWrites([{ op: 'confirm', factId: OLD_ID }], idSequence())
    expect(plan).toEqual({ adds: [], confirms: [OLD_ID] })
  })

  describe('identifier facts (Q3)', () => {
    const VALUE = 'B-XY 4711'
    const op: FactOperation = {
      op: 'add',
      fact: {
        ...swims,
        kind: 'circumstance',
        statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
        identifier: { kind: 'licence_plate', label: 'licence plate', value: VALUE },
      },
    }

    it('moves the value into a secure value and leaves a reference in the stored statement', () => {
      const plan = planFactWrites([op], idSequence(FACT_ID, SECURE_ID))
      const fact = plan.adds[0]!
      expect(fact.secureValue).toEqual({
        id: SECURE_ID,
        kind: 'licence_plate',
        label: 'licence plate',
        value: VALUE,
      })
      expect(fact.storedStatement).toBe(
        `The user's licence plate is ${secureReferenceToken(SECURE_ID)}`,
      )
      expect(fact.displayStatement).toBe(`The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`)
    })

    it('the value appears nowhere else in the plan: not in the statements, not in the keyword surface', () => {
      const plan = planFactWrites([op], idSequence(FACT_ID, SECURE_ID))
      const { secureValue, ...rest } = plan.adds[0]!
      expect(secureValue?.value).toBe(VALUE)
      expect(JSON.stringify(rest)).not.toContain(VALUE)
      expect(JSON.stringify(plan.confirms)).not.toContain(VALUE)
      // the lexical surface keeps the words around the value, so "licence plate" is findable
      expect(rest.lexicalText).toContain('licence plate')
    })
  })
})

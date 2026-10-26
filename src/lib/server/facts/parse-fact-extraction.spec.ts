import { describe, expect, it } from 'vitest'
import { FAKE_SECRETS } from '$lib/test/secret-fixtures'
import { FACT_EXTRACTION_MAX_FACTS, SECURE_VALUE_PLACEHOLDER } from './fact-vocabulary'
import { parseFactExtraction, type FactExtractionRefs } from './parse-fact-extraction'

const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'
const E1 = '33333333-3333-4333-8333-333333333333'

const refs: FactExtractionRefs = {
  facts: new Map([
    ['F1', F1],
    ['F2', F2],
  ]),
  entities: new Map([['E1', E1]]),
}

const swims = {
  op: 'add',
  subject: { kind: 'user' },
  kind: 'activity',
  statement: 'Swims at the local pool',
  confidence: 0.92,
  inferred: false,
  identifier: null,
}

const parse = (facts: unknown[], context: FactExtractionRefs = refs) =>
  parseFactExtraction(JSON.stringify({ facts }), context)

describe('parseFactExtraction', () => {
  it('parses an add about the user into a typed operation', () => {
    const out = parse([{ ...swims, statement: '  Swims at the local pool  ' }])
    expect(out.droppedLowConfidence).toBe(0)
    expect(out.operations).toEqual([
      {
        op: 'add',
        fact: {
          subject: { kind: 'user' },
          kind: 'activity',
          statement: 'Swims at the local pool',
          confidence: 0.92,
          inferred: false,
          identifier: null,
        },
      },
    ])
  })

  it('attributes a fact about someone else to that person, linked to the graph entity by ref', () => {
    const out = parse([
      {
        op: 'add',
        subject: { kind: 'person', label: 'Mia (friend)', entity: 'E1' },
        kind: 'health',
        statement: 'Mia (friend) keeps getting headaches',
        confidence: 0.9,
        inferred: false,
      },
      {
        op: 'add',
        subject: { kind: 'person', label: 'Mia (friend)', entity: null },
        kind: 'habit',
        statement: 'Mia (friend) barely drinks water',
        confidence: 0.85,
        inferred: true,
      },
    ])
    expect(out.operations.map((o) => (o.op === 'confirm' ? null : o.fact.subject))).toEqual([
      { kind: 'person', label: 'Mia (friend)', entityId: E1 },
      { kind: 'person', label: 'Mia (friend)', entityId: null },
    ])
  })

  it('rejects a person subject without a label, an unknown entity ref, and an entity on the user', () => {
    const person = (subject: unknown) => () =>
      parse([{ ...swims, subject, statement: 'Mia rarely drinks water' }])
    expect(person({ kind: 'person', entity: null })).toThrow(/label/)
    expect(person({ kind: 'person', label: '  ', entity: null })).toThrow(/label/)
    expect(person({ kind: 'person', label: 'Mia', entity: 'E9' })).toThrow(/E9/)
    expect(person({ kind: 'user', entity: 'E1' })).toThrow(/entity/)
    expect(person({ kind: 'robot' })).toThrow(/subject/)
    expect(person('user')).toThrow(/subject/)
  })

  it('maps an update to the stored fact it supersedes', () => {
    const out = parse([
      { ...swims, op: 'update', supersedes: 'F2', kind: 'habit', statement: 'Quit coffee' },
    ])
    expect(out.operations).toEqual([
      {
        op: 'update',
        supersedesFactId: F2,
        fact: expect.objectContaining({ statement: 'Quit coffee', kind: 'habit' }),
      },
    ])
  })

  it('maps a confirm to the stored fact it restates and needs nothing else', () => {
    const out = parse([{ op: 'confirm', confirms: 'F1' }])
    expect(out.operations).toEqual([{ op: 'confirm', factId: F1 }])
  })

  it('ignores "none" entries and accepts an empty list', () => {
    expect(parse([{ op: 'none' }]).operations).toEqual([])
    expect(parse([]).operations).toEqual([])
  })

  it('rejects refs the model was not given, missing refs, mixed refs and a stored fact used twice', () => {
    expect(() => parse([{ ...swims, op: 'update', supersedes: 'F9' }])).toThrow(/F9/)
    expect(() => parse([{ ...swims, op: 'update' }])).toThrow(/supersedes/)
    expect(() => parse([{ op: 'confirm', confirms: 'F9' }])).toThrow(/F9/)
    expect(() => parse([{ op: 'confirm' }])).toThrow(/confirms/)
    expect(() => parse([{ ...swims, supersedes: 'F1' }])).toThrow(/supersedes/)
    expect(() => parse([{ ...swims, confirms: 'F1' }])).toThrow(/confirms/)
    expect(() =>
      parse([
        { op: 'confirm', confirms: 'F1' },
        { ...swims, op: 'update', supersedes: 'F1' },
      ]),
    ).toThrow(/F1/)
  })

  describe('confidence gate (Q2)', () => {
    it('does not store a fact below 0.7 and counts it', () => {
      const out = parse([
        { ...swims, confidence: 0.69, inferred: true },
        { ...swims, statement: 'Likes jazz', kind: 'preference', confidence: 0.7 },
        { ...swims, op: 'update', supersedes: 'F1', confidence: 0.4 },
      ])
      expect(out.operations).toHaveLength(1)
      expect(out.operations[0]).toMatchObject({ op: 'add', fact: { statement: 'Likes jazz' } })
      expect(out.droppedLowConfidence).toBe(2)
    })

    it('a dropped update leaves the stored fact it named untouched (and unclaimed)', () => {
      const out = parse([
        { ...swims, op: 'update', supersedes: 'F1', confidence: 0.3 },
        { op: 'confirm', confirms: 'F1' },
      ])
      expect(out.operations).toEqual([{ op: 'confirm', factId: F1 }])
    })

    it('rejects a confidence that is not a number in [0, 1]', () => {
      for (const confidence of [1.2, -0.1, '0.9', null, undefined]) {
        expect(() => parse([{ ...swims, confidence }])).toThrow(/confidence/)
      }
    })
  })

  describe('contract violations fail loud (no repair)', () => {
    it('rejects non-JSON, a non-object, a missing facts array and an unknown op', () => {
      expect(() => parseFactExtraction('not json', refs)).toThrow()
      expect(() => parseFactExtraction('[]', refs)).toThrow(/object/)
      expect(() => parseFactExtraction('{"facts":"x"}', refs)).toThrow(/facts/)
      expect(() => parse([{ ...swims, op: 'upsert' }])).toThrow(/op/)
      expect(() => parse(['x'])).toThrow(/object/)
    })

    it('accepts a fenced reply like every other JSON step', () => {
      const out = parseFactExtraction('```json\n{"facts":[]}\n```', refs)
      expect(out.operations).toEqual([])
    })

    it('rejects a kind outside the catalog, an empty or over-long statement, and a non-boolean inferred', () => {
      expect(() => parse([{ ...swims, kind: 'hobby' }])).toThrow(/kind/)
      expect(() => parse([{ ...swims, statement: '  ' }])).toThrow(/statement/)
      expect(() => parse([{ ...swims, statement: 'x'.repeat(501) }])).toThrow(/statement/)
      expect(() => parse([{ ...swims, inferred: 'yes' }])).toThrow(/inferred/)
    })

    it(`rejects more than ${FACT_EXTRACTION_MAX_FACTS} facts for one capture`, () => {
      const many = Array.from({ length: FACT_EXTRACTION_MAX_FACTS + 1 }, (_, i) => ({
        ...swims,
        statement: `Fact ${i}`,
      }))
      expect(() => parse(many)).toThrow(/at most/)
    })

    it('rejects a statement that carries a credential-shaped value', () => {
      const attempt = () => parse([{ ...swims, statement: `Uses the key ${FAKE_SECRETS.openai}` }])
      expect(attempt).toThrow(/credential/)
      try {
        attempt()
      } catch (err) {
        expect(String((err as Error).message)).not.toContain(FAKE_SECRETS.openai)
      }
    })
  })

  describe('identifiers (Q3): the value never rides in the statement', () => {
    const PLATE = 'B-XY 4711'
    const plate = {
      op: 'add',
      subject: { kind: 'user' },
      kind: 'circumstance',
      statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
      confidence: 0.95,
      inferred: false,
      identifier: { kind: 'licence_plate', label: 'licence plate', value: PLATE },
    }

    it('parses the identifier separately from a statement that holds only the placeholder', () => {
      const out = parse([plate])
      expect(out.operations[0]).toMatchObject({
        op: 'add',
        fact: {
          statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
          identifier: { kind: 'licence_plate', label: 'licence plate', value: PLATE },
        },
      })
    })

    it('rejects a statement that contains the value, without echoing the value in the error', () => {
      const attempt = () =>
        parse([{ ...plate, statement: `The user's plate ${SECURE_VALUE_PLACEHOLDER} (${PLATE})` }])
      expect(attempt).toThrow(/identifier/)
      try {
        attempt()
      } catch (err) {
        expect(String((err as Error).message)).not.toContain(PLATE)
      }
    })

    it('rejects an identifier whose statement lacks exactly one placeholder, and a placeholder without an identifier', () => {
      expect(() => parse([{ ...plate, statement: 'The user has a licence plate' }])).toThrow(
        /placeholder/,
      )
      expect(() =>
        parse([
          {
            ...plate,
            statement: `${SECURE_VALUE_PLACEHOLDER} and ${SECURE_VALUE_PLACEHOLDER}`,
          },
        ]),
      ).toThrow(/placeholder/)
      expect(() =>
        parse([{ ...swims, statement: `Number ${SECURE_VALUE_PLACEHOLDER}`, identifier: null }]),
      ).toThrow(/placeholder/)
    })

    it('rejects an unknown identifier kind, an empty label or value, and a non-object identifier', () => {
      const bad = (identifier: unknown) => () => parse([{ ...plate, identifier }])
      expect(bad({ kind: 'shoe_size', label: 'x', value: PLATE })).toThrow(/identifier/)
      expect(bad({ kind: 'licence_plate', label: ' ', value: PLATE })).toThrow(/identifier/)
      expect(bad({ kind: 'licence_plate', label: 'plate', value: ' ' })).toThrow(/identifier/)
      expect(bad('B-XY 4711')).toThrow(/identifier/)
    })

    it('refuses to keep a credential as an identifier value (credentials are never memory)', () => {
      const attempt = () =>
        parse([
          { ...plate, identifier: { kind: 'other', label: 'key', value: FAKE_SECRETS.openai } },
        ])
      expect(attempt).toThrow(/credential/)
      try {
        attempt()
      } catch (err) {
        expect(String((err as Error).message)).not.toContain(FAKE_SECRETS.openai)
      }
    })

    it('drops an identifier fact below the confidence gate together with its value', () => {
      const out = parse([{ ...plate, confidence: 0.5 }])
      expect(out.operations).toEqual([])
      expect(out.droppedLowConfidence).toBe(1)
      expect(JSON.stringify(out)).not.toContain(PLATE)
    })

    it("the person owning the identifier is the subject (Mom's phone number is not the user's)", () => {
      const out = parse([
        {
          ...plate,
          subject: { kind: 'person', label: 'Mom', entity: null },
          statement: `Mom's phone number is ${SECURE_VALUE_PLACEHOLDER}`,
          identifier: { kind: 'phone', label: 'phone number', value: '+49 30 1234567' },
        },
      ])
      expect(out.operations[0]).toMatchObject({
        fact: { subject: { kind: 'person', label: 'Mom' }, identifier: { kind: 'phone' } },
      })
    })
  })
})

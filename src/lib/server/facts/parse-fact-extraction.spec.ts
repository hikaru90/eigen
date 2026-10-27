import { describe, expect, it } from 'vitest'
import { FAKE_SECRETS } from '$lib/test/secret-fixtures'
import { FACT_EXTRACTION_MAX_FACTS, SECURE_VALUE_PLACEHOLDER } from './fact-vocabulary'
import {
  FactExtractionRefError,
  parseFactCandidates,
  type FactCandidateRefs,
} from './parse-fact-extraction'

const E1 = '33333333-3333-4333-8333-333333333333'

const refs: FactCandidateRefs = { entities: new Map([['E1', E1]]) }

const swims = {
  statement: 'Swims at the local pool',
  subject: null,
  entity: null,
  inferred: false,
  identifier: null,
}

const parse = (candidates: unknown[], context: FactCandidateRefs = refs) =>
  parseFactCandidates(JSON.stringify({ candidates }), context)

describe('parseFactCandidates (the chat model only proposes statements; Jev decides everything else)', () => {
  it('parses a candidate about the author: no subject label, no entity', () => {
    expect(parse([{ ...swims, statement: '  Swims at the local pool  ' }])).toEqual([
      {
        statement: 'Swims at the local pool',
        subjectLabel: null,
        entityId: null,
        inferred: false,
        identifier: null,
      },
    ])
  })

  it('parses a candidate about someone else with the person label and the graph entity by ref', () => {
    const out = parse([
      {
        statement: 'Mia (friend) keeps getting headaches',
        subject: 'Mia (friend)',
        entity: 'E1',
        inferred: false,
      },
      {
        statement: 'Mia (friend) barely drinks water',
        subject: 'Mia (friend)',
        entity: null,
        inferred: true,
      },
    ])
    expect(out.map((c) => [c.subjectLabel, c.entityId, c.inferred])).toEqual([
      ['Mia (friend)', E1, false],
      ['Mia (friend)', null, true],
    ])
  })

  it('reads only statement, subject, entity, inferred and identifier: no op, kind or confidence, from anyone', () => {
    const out = parse([
      {
        ...swims,
        op: 'update',
        supersedes: 'F1',
        kind: 'activity',
        confidence: 0.99,
      },
    ])
    expect(Object.keys(out[0]!).sort()).toEqual([
      'entityId',
      'identifier',
      'inferred',
      'statement',
      'subjectLabel',
    ])
  })

  it('accepts an empty list and a fenced reply', () => {
    expect(parse([])).toEqual([])
    expect(parseFactCandidates('```json\n{"candidates":[]}\n```', refs)).toEqual([])
  })

  it('an entity ref the model was never offered is a recoverable slip (FactExtractionRefError), told apart from other errors', () => {
    const attempt = () =>
      parse([{ statement: 'Mia keeps getting headaches', subject: 'Mia', entity: 'E9', inferred: false }])
    expect(attempt).toThrow(FactExtractionRefError)
    try {
      attempt()
    } catch (err) {
      expect((err as FactExtractionRefError).detail).toEqual({
        index: 0,
        list: 'known people',
        field: 'entity',
      })
      expect(String((err as Error).message)).toContain('E9')
    }
    expect(() => parse([{ ...swims, statement: '  ' }])).not.toThrow(FactExtractionRefError)
  })

  it('rejects an entity without a subject label, a blank or non-string subject, and an entity that is not a string', () => {
    expect(() => parse([{ ...swims, entity: 'E1' }])).toThrow(/entity needs a subject label/)
    expect(() => parse([{ ...swims, subject: '  ' }])).toThrow(/subject/)
    expect(() => parse([{ ...swims, subject: { kind: 'user' } }])).toThrow(/subject/)
    expect(() => parse([{ ...swims, subject: 'Mia', entity: 7 }])).toThrow(FactExtractionRefError)
  })

  describe('contract violations fail loud (no repair)', () => {
    it('rejects non-JSON, a non-object, a missing candidates array and a non-object entry', () => {
      expect(() => parseFactCandidates('not json', refs)).toThrow(/user fact extraction/)
      expect(() => parseFactCandidates('[]', refs)).toThrow(/object/)
      expect(() => parseFactCandidates('{"candidates":"x"}', refs)).toThrow(/candidates/)
      expect(() => parseFactCandidates('{"facts":[]}', refs)).toThrow(/candidates/)
      expect(() => parse(['x'])).toThrow(/object/)
    })

    it('rejects an empty or over-long statement and a non-boolean inferred', () => {
      expect(() => parse([{ ...swims, statement: '  ' }])).toThrow(/statement/)
      expect(() => parse([{ ...swims, statement: 'x'.repeat(501) }])).toThrow(/statement/)
      expect(() => parse([{ ...swims, inferred: 'yes' }])).toThrow(/inferred/)
      expect(() => parse([{ ...swims, inferred: undefined }])).toThrow(/inferred/)
    })

    it(`rejects more than ${FACT_EXTRACTION_MAX_FACTS} candidates for one capture`, () => {
      const many = Array.from({ length: FACT_EXTRACTION_MAX_FACTS + 1 }, (_, i) => ({
        ...swims,
        statement: `Fact ${i}`,
      }))
      expect(() => parse(many)).toThrow(/at most/)
    })

    it('rejects a statement or subject label that carries a credential-shaped value, without echoing it', () => {
      for (const candidate of [
        { ...swims, statement: `Uses the key ${FAKE_SECRETS.openai}` },
        { ...swims, subject: `Bob ${FAKE_SECRETS.openai}` },
      ]) {
        const attempt = () => parse([candidate])
        expect(attempt).toThrow(/credential/)
        try {
          attempt()
        } catch (err) {
          expect(String((err as Error).message)).not.toContain(FAKE_SECRETS.openai)
        }
      }
    })
  })

  describe('identifiers (Q3): the value never rides in the statement', () => {
    const PLATE = 'B-XY 4711'
    const plate = {
      statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
      subject: null,
      entity: null,
      inferred: false,
      identifier: { kind: 'licence_plate', label: 'licence plate', value: PLATE },
    }

    it('parses the identifier separately from a statement that holds only the placeholder', () => {
      expect(parse([plate])[0]).toMatchObject({
        statement: `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`,
        identifier: { kind: 'licence_plate', label: 'licence plate', value: PLATE },
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
          { ...plate, statement: `${SECURE_VALUE_PLACEHOLDER} and ${SECURE_VALUE_PLACEHOLDER}` },
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
        parse([{ ...plate, identifier: { kind: 'other', label: 'key', value: FAKE_SECRETS.openai } }])
      expect(attempt).toThrow(/credential/)
      try {
        attempt()
      } catch (err) {
        expect(String((err as Error).message)).not.toContain(FAKE_SECRETS.openai)
      }
    })

    it("the person owning the identifier is named by the subject label (Mom's phone number is not the user's)", () => {
      expect(
        parse([
          {
            statement: `Mom's phone number is ${SECURE_VALUE_PLACEHOLDER}`,
            subject: 'Mom',
            entity: null,
            inferred: false,
            identifier: { kind: 'phone', label: 'phone number', value: '+49 30 1234567' },
          },
        ])[0],
      ).toMatchObject({ subjectLabel: 'Mom', identifier: { kind: 'phone' } })
    })
  })
})

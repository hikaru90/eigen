import { describe, expect, it } from 'vitest'
import {
  FACT_CONFIDENCE_MIN,
  FACT_KINDS,
  FACT_STATUSES,
  SECURE_VALUE_KINDS,
  SECURE_VALUE_PLACEHOLDER,
  bindSecureReference,
  countSecurePlaceholders,
  factSubjectLabel,
  secureReferencePattern,
  secureReferenceToken,
  statementForIndex,
} from './fact-vocabulary'

const SECURE_ID = '5f3a9c1e-1b2d-4c3e-8f4a-0123456789ab'

describe('fact vocabulary', () => {
  it('has the kind catalog of the plan, the three statuses and the 0.7 inferred-fact gate', () => {
    expect([...FACT_KINDS]).toEqual([
      'preference',
      'dislike',
      'habit',
      'activity',
      'health',
      'circumstance',
      'relationship',
      'plan',
      'constraint',
      'trait',
    ])
    expect([...FACT_STATUSES]).toEqual(['active', 'superseded', 'forgotten'])
    expect(FACT_CONFIDENCE_MIN).toBe(0.7)
    expect(SECURE_VALUE_KINDS).toContain('licence_plate')
    expect(SECURE_VALUE_KINDS).toContain('email')
  })
})

describe('secure reference tokens', () => {
  it('binds the placeholder to a reference token and back to the placeholder for indexing', () => {
    const display = `The user's licence plate is ${SECURE_VALUE_PLACEHOLDER}`
    const stored = bindSecureReference(display, SECURE_ID)
    expect(stored).toBe(`The user's licence plate is [secure:${SECURE_ID}]`)
    expect(secureReferenceToken(SECURE_ID)).toBe(`[secure:${SECURE_ID}]`)
    // what the embedding, the lexical surface and every prompt see: no id
    expect(statementForIndex(stored)).toBe(display)
    expect(statementForIndex(stored)).not.toContain(SECURE_ID)
  })

  it('finds every token of a text with its id, case-insensitively, and nothing else', () => {
    const other = '11111111-2222-4333-8444-555555555555'
    const text = `a [secure:${SECURE_ID}] b [SECURE:${other.toUpperCase()}] c [secure value] d [secure:not-an-id]`
    const ids = [...text.matchAll(secureReferencePattern())].map((m) => m[1]!.toLowerCase())
    expect(ids).toEqual([SECURE_ID, other])
  })

  it('counts placeholders', () => {
    expect(countSecurePlaceholders('no placeholder')).toBe(0)
    expect(countSecurePlaceholders(`one ${SECURE_VALUE_PLACEHOLDER}`)).toBe(1)
    expect(
      countSecurePlaceholders(`${SECURE_VALUE_PLACEHOLDER} and ${SECURE_VALUE_PLACEHOLDER}`),
    ).toBe(2)
  })
})

describe('factSubjectLabel', () => {
  it('names the user as "the user" and another person by the label the capture gave', () => {
    expect(factSubjectLabel({ subjectKind: 'user', subjectLabel: null })).toBe('the user')
    expect(factSubjectLabel({ subjectKind: 'person', subjectLabel: 'Mia (friend)' })).toBe(
      'Mia (friend)',
    )
  })

  it('never mislabels a person without a label as the user', () => {
    expect(factSubjectLabel({ subjectKind: 'person', subjectLabel: null })).toBe('a person')
  })
})

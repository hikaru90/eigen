import { describe, expect, it } from 'vitest'
import { checksAfterEdit, checksBeforeEdit, resolveChecks } from './qa-checks'
import type { EvalQaRecord } from '../../src/lib/eval/qa-store'

const editQa: EvalQaRecord = {
  id: 'qa_edit_allergy_update',
  question: 'what is Marcus allergic to now',
  acceptance: 'Must state pecan allergy (updated).',
  captures: [{ fixtureId: 'ec_011', rawText: 'Marcus is allergic to walnuts.' }],
  retrievalQuery: null,
  retrievalRelevant: [],
  tags: ['edit'],
  edit: {
    fixtureId: 'ec_011',
    newRawText: 'Correction: Marcus is allergic to pecans, not walnuts.',
  },
  checks: {
    entities: [{ fixtureId: 'ec_011', minCount: 1, surfacesContaining: ['pecan'] }],
  },
  createdAt: '',
  updatedAt: '',
}

describe('checksBeforeEdit', () => {
  it('maps pecan surface needles to walnut before the edit step', () => {
    const before = checksBeforeEdit(editQa)
    expect(before.entities?.[0]?.surfacesContaining).toEqual(['walnut'])
    expect(resolveChecks(editQa).entities?.[0]?.surfacesContaining).toEqual(['pecan'])
  })

  it('leaves checks unchanged when there is no edit step', () => {
    const plain: EvalQaRecord = { ...editQa, edit: null }
    expect(checksBeforeEdit(plain)).toEqual(resolveChecks(plain))
  })
})

describe('checksAfterEdit', () => {
  it('returns pecan entity checks for post-edit verification', () => {
    expect(checksAfterEdit(editQa)).toEqual({
      entities: [{ fixtureId: 'ec_011', minCount: 1, surfacesContaining: ['pecan'] }],
    })
  })

  it('returns null when catalog has no pecan entity requirements', () => {
    const plain: EvalQaRecord = { ...editQa, edit: null, checks: {} }
    expect(checksAfterEdit(plain)).toBeNull()
  })
})

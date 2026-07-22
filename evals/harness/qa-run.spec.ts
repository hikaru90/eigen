import { describe, expect, it } from 'vitest'
import { expandQa, expandQaEntries } from './qa-run'
import type { EvalQaRecord } from '../../src/lib/eval/qa-store'

const sampleQa: EvalQaRecord = {
  id: 'qa_test',
  question: 'what should I avoid bringing to dinner with Marcus',
  acceptance: 'Must mention walnut allergy for Marcus.',
  captures: [
    {
      fixtureId: 'ec_011',
      rawText: 'Marcus is allergic to walnuts. Do not bring walnut bread to dinner.',
    },
  ],
  retrievalQuery: null,
  retrievalRelevant: [],
  tags: [],
  edit: null,
  checks: {},
  createdAt: '',
  updatedAt: '',
}

const secondQa: EvalQaRecord = {
  id: 'qa_test_2',
  question: 'what flour does Marcus use',
  acceptance: 'Must mention rice flour.',
  captures: [
    { fixtureId: 'ec_011', rawText: 'Marcus is allergic to walnuts.' },
    { fixtureId: 'ec_006', rawText: 'Marcus uses rice flour in banneton.' },
  ],
  retrievalQuery: null,
  retrievalRelevant: [],
  tags: [],
  edit: null,
  checks: {},
  createdAt: '',
  updatedAt: '',
}

const retrievalQa: EvalQaRecord = {
  ...sampleQa,
  id: 'qa_retrieval',
  retrievalQuery: 'Marcus allergy',
  retrievalRelevant: [{ id: 'ec_011', grade: 3 }],
  tags: ['recall'],
}

const editQa: EvalQaRecord = {
  ...sampleQa,
  id: 'qa_edit',
  edit: { fixtureId: 'ec_011', newRawText: 'Marcus is allergic to pecans.' },
}

describe('expandQa', () => {
  it('orders captures, check, then answer', () => {
    const entries = expandQa(sampleQa)
    expect(entries.map((e) => e.kind)).toEqual(['capture', 'check', 'answer'])
  })

  it('includes acceptance on answer entry', () => {
    const answer = expandQa(sampleQa).find((e) => e.kind === 'answer')
    expect(answer?.expectedJson.acceptance).toBe(sampleQa.acceptance)
    expect(answer?.inputJson.question).toBe(sampleQa.question)
  })

  it('includes retrievalQuery on answer entry when configured', () => {
    const answer = expandQa(retrievalQa).find((e) => e.kind === 'answer')
    expect(answer?.inputJson.retrievalQuery).toBe('Marcus allergy')
  })

  it('inserts retrieval after check when configured', () => {
    const kinds = expandQa(retrievalQa).map((e) => e.kind)
    expect(kinds).toEqual(['capture', 'check', 'retrieval', 'answer'])
  })

  it('inserts edit after check when configured', () => {
    const kinds = expandQa(editQa).map((e) => e.kind)
    expect(kinds).toEqual(['capture', 'check', 'edit', 'answer'])
  })

  it('inserts post-edit check when catalog expects pecan surfaces', () => {
    const editWithChecks: EvalQaRecord = {
      ...editQa,
      checks: {
        entities: [{ fixtureId: 'ec_011', minCount: 1, surfacesContaining: ['pecan'] }],
      },
    }
    const entries = expandQa(editWithChecks)
    const preCheck = entries.find((e) => e.fixtureRef === 'qa_edit_check')
    const postCheck = entries.find((e) => e.fixtureRef === 'qa_edit_post_edit_check')
    expect(preCheck?.inputJson.checks).toEqual({
      entities: [{ fixtureId: 'ec_011', minCount: 1, surfacesContaining: ['walnut'] }],
    })
    expect(postCheck?.inputJson.checks).toEqual({
      entities: [{ fixtureId: 'ec_011', minCount: 1, surfacesContaining: ['pecan'] }],
    })
    const kinds = entries.map((e) => e.kind)
    expect(kinds).toEqual(['capture', 'check', 'edit', 'check', 'answer'])
  })

  it('passes retrieval thresholds from checks on retrieval entry', () => {
    const retrieval = expandQa({
      ...retrievalQa,
      checks: { retrieval: { minNdcgAt10: 0.7, needleFixtureId: 'ec_011', needleTopK: 3 } },
    }).find((e) => e.kind === 'retrieval')
    expect(retrieval?.expectedJson.minNdcgAt10).toBe(0.7)
    expect(retrieval?.expectedJson.needleFixtureId).toBe('ec_011')
    expect(retrieval?.expectedJson.needleTopK).toBe(3)
  })
})

describe('expandQaEntries', () => {
  it('dedupes captures and batches checks then answers for multi-QA runs without edits', () => {
    const entries = expandQaEntries([sampleQa, secondQa])
    expect(entries.filter((e) => e.kind === 'capture')).toHaveLength(2)
    expect(entries.filter((e) => e.kind === 'answer')).toHaveLength(2)
    expect(entries.map((e) => e.kind)).toEqual([
      'capture',
      'capture',
      'check',
      'check',
      'answer',
      'answer',
    ])
    expect(entries.filter((e) => e.inputJson.parallelWave === 'check')).toHaveLength(2)
    expect(entries.filter((e) => e.inputJson.parallelWave === 'answer')).toHaveLength(2)
  })

  it('batches retrieval entries into a parallel wave when multi-QA has retrieval', () => {
    const entries = expandQaEntries([
      retrievalQa,
      { ...secondQa, id: 'qa_retrieval_2', retrievalQuery: 'rice flour', tags: ['recall'] },
    ])
    expect(entries.map((e) => e.kind)).toEqual([
      'capture',
      'capture',
      'check',
      'check',
      'retrieval',
      'retrieval',
      'answer',
      'answer',
    ])
    expect(entries.filter((e) => e.inputJson.parallelWave === 'retrieval')).toHaveLength(2)
  })

  it('inserts fixture reset edit before a later QA when a shared fixture was edited', () => {
    const entries = expandQaEntries([editQa, sampleQa])
    const reset = entries.find((e) => e.fixtureRef === 'qa_test_fixture_reset_ec_011')
    expect(reset?.kind).toBe('edit')
    expect(reset?.inputJson).toEqual({
      fixtureId: 'ec_011',
      newRawText: sampleQa.captures[0]!.rawText,
    })
    const editIdx = entries.findIndex((e) => e.fixtureRef === 'qa_edit_edit')
    const resetIdx = entries.findIndex((e) => e.fixtureRef === 'qa_test_fixture_reset_ec_011')
    expect(resetIdx).toBeGreaterThan(editIdx)
  })
})

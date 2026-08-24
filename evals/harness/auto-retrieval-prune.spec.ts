import type { CheckAssertionResult } from './qa-types'
import { describe, expect, it } from 'vitest'
import {
  ingestBrokenFromCheckAssertions,
  qaIdFromRetrievalFixtureRef,
  runtimeRetrievalRelevant,
} from './auto-retrieval-prune'

describe('qaIdFromRetrievalFixtureRef', () => {
  it('parses qa id from retrieval fixture ref', () => {
    expect(qaIdFromRetrievalFixtureRef('qa_jonas_creative_silence_retrieval')).toBe(
      'qa_jonas_creative_silence',
    )
    expect(qaIdFromRetrievalFixtureRef('capture')).toBeNull()
  })
})

describe('runtimeRetrievalRelevant', () => {
  const fixtureToUuid = new Map([
    ['ec_a', 'u-a'],
    ['ec_b', 'u-b'],
  ])

  it('skips uncaptured and ingest-broken haystack labels', () => {
    const assertions: CheckAssertionResult[] = [
      { id: 'entities_ec_b', label: '', passed: false, evidence: '', fixtureId: 'ec_b' },
    ]
    const ingestBroken = ingestBrokenFromCheckAssertions(assertions)
    const out = runtimeRetrievalRelevant({
      relevant: [
        { id: 'ec_a', grade: 3 },
        { id: 'ec_b', grade: 3 },
        { id: 'ec_missing', grade: 2 },
      ],
      fixtureToUuid,
      ingestBroken,
    })
    expect(out.scoped).toEqual([{ id: 'ec_a', grade: 3 }])
    expect(out.skippedIngestBroken).toEqual(['ec_b'])
    expect(out.skippedUncaptured).toEqual(['ec_missing'])
  })

  it('keeps needle in grades when ingest failed on needle', () => {
    const ingestBroken = new Set(['ec_needle'])
    const out = runtimeRetrievalRelevant({
      relevant: [{ id: 'ec_needle', grade: 3 }],
      fixtureToUuid: new Map([['ec_needle', 'u-n']]),
      ingestBroken,
      needleFixtureId: 'ec_needle',
    })
    expect(out.scoped).toEqual([{ id: 'ec_needle', grade: 3 }])
    expect(out.ingestBrokenNeedleRetained).toEqual(['ec_needle'])
    expect(out.skippedIngestBroken).toEqual([])
  })
})

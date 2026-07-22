import { describe, expect, it } from 'vitest'
import type { EvalEntry } from '$lib/server/db/brain.schema'
import {
  allBrokenFixtureIds,
  brokenFixturesFromEntries,
  entriesToRerunForFixtures,
  fixtureIdsRequiringEntityResolution,
  planIngestRetries,
} from './ingest-retry'

function entry(partial: Partial<EvalEntry> & Pick<EvalEntry, 'kind' | 'ordinal'>): EvalEntry {
  return {
    id: partial.id ?? `e-${partial.ordinal}`,
    runId: 'run-1',
    fixtureRef: partial.fixtureRef ?? null,
    inputJson: partial.inputJson ?? {},
    expectedJson: partial.expectedJson ?? {},
    status: partial.status ?? 'completed',
    passed: partial.passed ?? true,
    resultJson: partial.resultJson ?? {},
    error: partial.error ?? null,
    durationMs: partial.durationMs ?? null,
    startedAt: partial.startedAt ?? null,
    finishedAt: partial.finishedAt ?? null,
    dependsOnEntryId: partial.dependsOnEntryId ?? null,
    ...partial,
  }
}

describe('fixtureIdsRequiringEntityResolution', () => {
  it('includes only fixtures with minCount or surface requirements', () => {
    expect(
      fixtureIdsRequiringEntityResolution({
        entities: [
          { fixtureId: 'ec_jonas_silence', minCount: 1, surfacesContaining: ['Jonas'] },
          { fixtureId: 'ec_jprod_01', minCount: 0 },
        ],
      }),
    ).toEqual(['ec_jonas_silence'])
  })
})

describe('brokenFixturesFromEntries', () => {
  it('collects ingest-broken fixtures from failed check assertions', () => {
    const entries = [
      entry({
        kind: 'check',
        ordinal: 41,
        fixtureRef: 'qa_jonas_creative_silence_check',
        inputJson: { qaId: 'qa_jonas_creative_silence' },
        passed: false,
        resultJson: {
          assertions: [
            {
              id: 'entities_ec_jonas_silence',
              label: 'People, places, and things mentioned',
              passed: false,
              fixtureId: 'ec_jonas_silence',
              evidence: 'No entities were extracted from this thought.',
            },
            {
              id: 'enriched_ec_jprod_08',
              label: 'Automatic tags and metadata',
              passed: false,
              fixtureId: 'ec_jprod_08',
              evidence: 'Thought was not fully enriched (missing tags or metadata).',
            },
          ],
        },
      }),
    ]
    const byQa = brokenFixturesFromEntries(entries)
    expect([...(byQa.get('qa_jonas_creative_silence') ?? [])].sort()).toEqual([
      'ec_jonas_silence',
      'ec_jprod_08',
    ])
  })

  it('collects failed capture fixtures only (not retrieval rank failures)', () => {
    const entries = [
      entry({
        kind: 'capture',
        ordinal: 1,
        fixtureRef: 'ec_jonas_silence',
        status: 'failed',
      }),
      entry({
        kind: 'retrieval',
        ordinal: 42,
        fixtureRef: 'qa_jonas_creative_silence_retrieval',
        passed: false,
        expectedJson: { needleFixtureId: 'ec_jonas_silence' },
      }),
    ]
    const byQa = brokenFixturesFromEntries(entries)
    expect([...(byQa.get('_global') ?? [])]).toEqual(['ec_jonas_silence'])
    expect(byQa.has('qa_jonas_creative_silence')).toBe(false)
  })
})

describe('entriesToRerunForFixtures', () => {
  it('returns capture, check, retrieval, and answer entries for a QA', () => {
    const entries = [
      entry({ kind: 'capture', ordinal: 0, fixtureRef: 'ec_jprod_01' }),
      entry({ kind: 'capture', ordinal: 39, fixtureRef: 'ec_jonas_silence' }),
      entry({
        kind: 'check',
        ordinal: 40,
        fixtureRef: 'qa_jonas_creative_silence_check',
        inputJson: { qaId: 'qa_jonas_creative_silence' },
      }),
      entry({
        kind: 'retrieval',
        ordinal: 41,
        fixtureRef: 'qa_jonas_creative_silence_retrieval',
      }),
      entry({ kind: 'answer', ordinal: 42, fixtureRef: 'qa_jonas_creative_silence' }),
    ]
    const rerun = entriesToRerunForFixtures({
      entries,
      qaId: 'qa_jonas_creative_silence',
      brokenFixtures: new Set(['ec_jonas_silence']),
    })
    expect(rerun.map((e) => `${e.kind}:${e.fixtureRef}`)).toEqual([
      'capture:ec_jonas_silence',
      'check:qa_jonas_creative_silence_check',
      'retrieval:qa_jonas_creative_silence_retrieval',
      'answer:qa_jonas_creative_silence',
    ])
  })
})

describe('planIngestRetries', () => {
  it('builds retry batches from failed check entries', () => {
    const entries = [
      entry({
        kind: 'check',
        ordinal: 41,
        fixtureRef: 'qa_jonas_creative_silence_check',
        inputJson: { qaId: 'qa_jonas_creative_silence' },
        passed: false,
        resultJson: {
          assertions: [
            {
              id: 'entities_ec_jonas_silence',
              passed: false,
              fixtureId: 'ec_jonas_silence',
              label: '',
              evidence: '',
            },
          ],
        },
      }),
      entry({ kind: 'capture', ordinal: 39, fixtureRef: 'ec_jonas_silence' }),
      entry({
        kind: 'retrieval',
        ordinal: 42,
        fixtureRef: 'qa_jonas_creative_silence_retrieval',
      }),
      entry({ kind: 'answer', ordinal: 43, fixtureRef: 'qa_jonas_creative_silence' }),
    ]
    const batches = planIngestRetries(entries)
    expect(batches).toHaveLength(1)
    expect(batches[0]?.qaId).toBe('qa_jonas_creative_silence')
    expect([...(batches[0]?.brokenFixtures ?? [])]).toEqual(['ec_jonas_silence'])
    expect(batches[0]?.entriesToRerun).toHaveLength(4)
  })
})

describe('allBrokenFixtureIds', () => {
  it('unions fixture ids across QA batches', () => {
    const batches = planIngestRetries([
      entry({
        kind: 'check',
        ordinal: 1,
        fixtureRef: 'qa_a_check',
        inputJson: { qaId: 'qa_a' },
        passed: false,
        resultJson: {
          assertions: [
            {
              id: 'enriched_ec_one',
              passed: false,
              fixtureId: 'ec_one',
              label: '',
              evidence: '',
            },
          ],
        },
      }),
      entry({
        kind: 'capture',
        ordinal: 0,
        fixtureRef: 'ec_two',
        status: 'failed',
      }),
    ])
    expect(allBrokenFixtureIds(batches).sort()).toEqual(['ec_one', 'ec_two'])
  })
})

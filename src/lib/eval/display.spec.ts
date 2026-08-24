import type { EvalEntrySummary, EvalRunListItem } from './types'
import { describe, expect, it } from 'vitest'
import {
  aggregateQaScores,
  aggregateRunScores,
  isRunScorePassing,
  resolveRunStatusFromScore,
  entriesForQa,
  formatRunOptionLabel,
  humanizeCheckAssertion,
  humanEntryTitle,
  humanNdcg,
  humanRunLabel,
  parseEvalGraphSnapshot,
} from './display'

describe('eval display', () => {
  it('humanizes graph check with capture text', () => {
    const entries: EvalEntrySummary[] = [
      {
        id: '1',
        ordinal: 0,
        kind: 'capture',
        fixtureRef: 'ec_011',
        status: 'completed',
        passed: true,
        durationMs: 1,
        error: null,
        input: { rawText: 'Marcus is allergic to walnuts.' },
        expected: {},
        result: { normalizedText: 'Marcus cannot eat walnuts.' },
      },
    ]
    const row = humanizeCheckAssertion(
      {
        id: 'graph_ec_011',
        label: 'Graph node exists (ec_011)',
        passed: true,
        evidence: 'Thought uuid found in AGE graph',
      },
      entries,
    )
    expect(row.label).toBe('Linked in knowledge graph')
    expect(row.preview).toContain('Marcus')
  })

  it('titles answer step from question', () => {
    const entries: EvalEntrySummary[] = [
      {
        id: '2',
        ordinal: 1,
        kind: 'answer',
        fixtureRef: 'qa_smoke',
        status: 'completed',
        passed: true,
        durationMs: 1,
        error: null,
        input: { question: 'What should I avoid for Marcus dinner?' },
        expected: {},
        result: null,
      },
    ]
    expect(humanEntryTitle(entries[0]!, entries)).toContain('Marcus')
  })

  it('formats ndcg as percent', () => {
    expect(humanNdcg(0.85)).toContain('85%')
  })

  it('aggregates points across categories', () => {
    const entries: EvalEntrySummary[] = [
      {
        id: 'c1',
        ordinal: 0,
        kind: 'capture',
        fixtureRef: 'ec_1',
        status: 'completed',
        passed: true,
        durationMs: 1,
        error: null,
        input: {},
        expected: {},
        result: { fidelityScore: 5 },
      },
      {
        id: 'k1',
        ordinal: 1,
        kind: 'check',
        fixtureRef: 'check',
        status: 'completed',
        passed: false,
        durationMs: 1,
        error: null,
        input: {},
        expected: {},
        result: {
          assertions: [
            { id: 'a1', label: 'A', passed: true },
            { id: 'a2', label: 'B', passed: false },
          ],
        },
      },
    ]
    const summary = aggregateRunScores(entries)
    expect(summary.possible).toBe(3)
    expect(summary.earned).toBe(2)
    expect(summary.percent).toBe(67)
    expect(summary.categories).toHaveLength(2)
  })

  it('treats full points as passing even when entry.passed flags differ', () => {
    const score = aggregateRunScores([
      {
        id: 'c1',
        ordinal: 0,
        kind: 'capture',
        fixtureRef: 'ec_a',
        status: 'completed',
        passed: false,
        durationMs: 1,
        error: null,
        input: {},
        expected: {},
        result: { fidelityScore: 5 },
      },
      {
        id: 'chk',
        ordinal: 1,
        kind: 'check',
        fixtureRef: 'qa_one_check',
        status: 'completed',
        passed: true,
        durationMs: 1,
        error: null,
        input: { qaId: 'qa_one' },
        expected: {},
        result: {
          assertions: [{ id: 'g_a', passed: true, fixtureId: 'ec_a' }],
        },
      },
    ])
    expect(isRunScorePassing(score)).toBe(true)
    expect(resolveRunStatusFromScore('failed', score)).toBe('completed')
  })

  it('formats run labels for dropdown', () => {
    expect(humanRunLabel('smoke:qa_smoke_dinner')).toContain('Smoke test')
    const run: EvalRunListItem = {
      id: '1',
      label: 'qa:qa_smoke_dinner',
      scenarioId: 'qa_smoke_dinner',
      status: 'completed',
      createdAt: '2026-05-19T15:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      entryCount: 10,
      passedCount: 9,
      failedCount: 1,
    }
    expect(formatRunOptionLabel(run)).toContain('9/10 passed')
  })

  it('scores only entries and assertions for one Q&A in a batch run', () => {
    const entries: EvalEntrySummary[] = [
      {
        id: 'c1',
        ordinal: 0,
        kind: 'capture',
        fixtureRef: 'ec_a',
        status: 'completed',
        passed: true,
        durationMs: 1,
        error: null,
        input: { rawText: 'A' },
        expected: {},
        result: { fidelityScore: 5 },
      },
      {
        id: 'c2',
        ordinal: 1,
        kind: 'capture',
        fixtureRef: 'ec_b',
        status: 'completed',
        passed: true,
        durationMs: 1,
        error: null,
        input: { rawText: 'B' },
        expected: {},
        result: { fidelityScore: 5 },
      },
      {
        id: 'chk',
        ordinal: 2,
        kind: 'check',
        fixtureRef: 'qa_one_check',
        status: 'completed',
        passed: true,
        durationMs: 1,
        error: null,
        input: { qaId: 'qa_one' },
        expected: {},
        result: {
          assertions: [
            { id: 'g_a', passed: true, fixtureId: 'ec_a' },
            { id: 'g_b', passed: false, fixtureId: 'ec_b' },
          ],
        },
      },
      {
        id: 'ans',
        ordinal: 3,
        kind: 'answer',
        fixtureRef: 'qa_one',
        status: 'completed',
        passed: true,
        durationMs: 1,
        error: null,
        input: { question: 'Q one?' },
        expected: {},
        result: {},
      },
    ]
    const slice = entriesForQa(entries, 'qa_one', ['ec_a'])
    expect(slice.map((e) => e.id)).toEqual(['c1', 'chk', 'ans'])
    const score = aggregateQaScores(entries, {
      id: 'qa_one',
      captures: [{ fixtureId: 'ec_a', rawText: 'A' }],
    })
    expect(score?.possible).toBe(3)
    expect(score?.earned).toBe(3)
  })

  it('parses graph snapshot from check result', () => {
    const snap = parseEvalGraphSnapshot({
      nodes: [
        { id: 't1', kind: 'Thought', label: 'hello', subtype: 'observation' },
        { id: 'ent1', kind: 'Entity', label: 'Acme', subtype: 'organization' },
      ],
      edges: [
        {
          id: 'e1',
          sourceId: 't1',
          targetId: 'ent1',
          relationType: 'mentions',
          kind: 'mention',
        },
      ],
      capturedAt: '2026-05-19T12:00:00.000Z',
    })
    expect(snap?.nodes).toHaveLength(2)
    expect(snap?.edges).toHaveLength(1)
    expect(snap?.capturedAt).toBe('2026-05-19T12:00:00.000Z')
  })

  it('drops graph edges whose endpoints are missing from stored snapshot', () => {
    const snap = parseEvalGraphSnapshot({
      nodes: [{ id: 't1', kind: 'Thought', label: 'hello', subtype: 'observation' }],
      edges: [
        {
          id: 'e1',
          sourceId: 't1',
          targetId: '1c995bbf-a909-488e-b9ad-b113adf17fac',
          relationType: 'mentions',
          kind: 'mention',
        },
      ],
    })
    expect(snap?.edges).toEqual([])
  })
})

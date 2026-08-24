import { describe, expect, it } from 'vitest'
import { solveTemporalQuestion } from '$lib/server/qa/temporal-solver'
import type { TemporalHintBinding } from '$lib/server/retrieval/resolve-temporal-hint-bindings'
import type { TemporalEventSeed } from '$lib/server/retrieval/temporal'
import { mergeQuestionEntityHints, shouldUseDeterministicSolverAnswer } from './query-entity-hints'

function seed(thoughtId: string, summary: string, startAt: string): TemporalEventSeed {
  const iso = `${startAt}T12:00:00.000Z`
  return {
    eventId: `ev-${thoughtId}`,
    thoughtId,
    semanticSummary: summary,
    startAt: new Date(iso),
    activePeriod: `[${iso},${iso.replace('T12:', 'T23:')})`,
    kind: 'milestone',
  }
}

function hintBindings(pairs: Array<[string, string]>): TemporalHintBinding[] {
  return pairs.map(([hint, thoughtId]) => ({
    hint,
    eventId: `ev-${thoughtId}`,
    thoughtId,
  }))
}

describe('mergeQuestionEntityHints', () => {
  it('dedupes identical classifier hints after trim', () => {
    const merged = mergeQuestionEntityHints([
      'Samsung Galaxy S22',
      'Samsung Galaxy S22',
      'Dell XPS 13',
    ])
    expect(merged).toEqual(['Samsung Galaxy S22', 'Dell XPS 13'])
  })

  it('does not parse the question string for hints', () => {
    expect(mergeQuestionEntityHints([])).toEqual([])
  })
})

describe('shouldUseDeterministicSolverAnswer', () => {
  it('blocks ordering bypass when classifier says comparativeOrdering is false', () => {
    const solver = solveTemporalQuestion({
      kind: 'ordering',
      entityHints: ['first service', 'GPS system'],
      hintBindings: hintBindings([
        ['first service', 'svc'],
        ['GPS system', 'gps'],
      ]),
      seeds: [
        seed('svc', 'Car first service', '2023-03-15'),
        seed('gps', 'GPS system issue', '2023-03-22'),
      ],
    })
    expect(
      shouldUseDeterministicSolverAnswer({
        intentKind: 'ordering',
        solverResult: solver,
        comparativeOrdering: false,
      }),
    ).toBe(false)
  })

  it('allows duration bypass when classifier kind matches', () => {
    const hints = mergeQuestionEntityHints(['starting to work with Rachel', 'find a house I loved'])
    const solver = solveTemporalQuestion({
      kind: 'duration',
      entityHints: hints,
      hintBindings: hintBindings([
        ['starting to work with Rachel', 'rachel'],
        ['find a house I loved', 'house'],
      ]),
      seeds: [
        seed('rachel', 'Started working with Rachel', '2022-02-15'),
        seed('house', 'Saw a house they loved', '2022-03-01'),
      ],
    })
    expect(
      shouldUseDeterministicSolverAnswer({
        intentKind: 'duration',
        solverResult: solver,
        comparativeOrdering: false,
      }),
    ).toBe(true)
  })
})

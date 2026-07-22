import { describe, expect, it } from 'vitest'
import type { TemporalHintBinding } from '$lib/server/retrieval/resolve-temporal-hint-bindings'
import {
  allowsComputedTimelineCitation,
  COMPUTED_TIMELINE_CITATION_ID,
  calendarDaysBetweenExclusive,
  calendarMonthsBetweenExclusive,
  calendarDaysBetweenInclusive,
  formatComputedTimelineForPrompt,
  formatSolverAnswer,
  seedsToTimelineEvents,
  solveTemporalQuestion,
  type TemporalSolverResult,
} from './temporal-solver'
import type { TemporalEventSeed } from '$lib/server/retrieval/temporal'

function seed(
  thoughtId: string,
  summary: string,
  startAt: string,
  kind: 'milestone' | 'inferred_event' = 'milestone',
): TemporalEventSeed {
  const iso = `${startAt}T00:00:00.000Z`
  return {
    eventId: `ev-${thoughtId}`,
    thoughtId,
    semanticSummary: summary,
    startAt: new Date(iso),
    activePeriod: `[${iso},${iso.replace('T00:', 'T23:')})`,
    kind,
  }
}

function hintBindings(pairs: Array<[string, string]>): TemporalHintBinding[] {
  return pairs.map(([hint, thoughtId]) => ({
    hint,
    eventId: `ev-${thoughtId}`,
    thoughtId,
  }))
}

describe('calendarDaysBetweenExclusive', () => {
  it('Jan 10 → Jan 17 = 7 days', () => {
    expect(
      calendarDaysBetweenExclusive(
        new Date('2023-01-10T00:00:00.000Z'),
        new Date('2023-01-17T00:00:00.000Z'),
      ),
    ).toBe(7)
  })

  it('Feb 15 → Mar 1 = 14 exclusive / 15 inclusive', () => {
    const from = new Date('2022-02-15T00:00:00.000Z')
    const to = new Date('2022-03-01T00:00:00.000Z')
    expect(calendarDaysBetweenExclusive(from, to)).toBe(14)
    expect(calendarDaysBetweenInclusive(from, to)).toBe(15)
  })

  it('Jan 2 → Feb 1 = 30 exclusive', () => {
    expect(
      calendarDaysBetweenExclusive(
        new Date('2023-01-02T00:00:00.000Z'),
        new Date('2023-02-01T00:00:00.000Z'),
      ),
    ).toBe(30)
  })

  it('Jun 14 → Jun 18 = 4 days', () => {
    expect(
      calendarDaysBetweenExclusive(
        new Date('2023-06-14T00:00:00.000Z'),
        new Date('2023-06-18T00:00:00.000Z'),
      ),
    ).toBe(4)
  })
})

describe('solveTemporalQuestion ordering', () => {
  it('Samsung Galaxy S22 before Dell XPS 13 (acquisition dates)', () => {
    const result = solveTemporalQuestion({
      kind: 'ordering',
      entityHints: ['Samsung Galaxy S22', 'Dell XPS 13'],
      hintBindings: hintBindings([
        ['Samsung Galaxy S22', 'samsung'],
        ['Dell XPS 13', 'dell'],
      ]),
      seeds: [
        seed('preorder', 'User pre-ordered Dell XPS 13 laptop', '2023-01-28', 'inferred_event'),
        seed('dell', 'Dell XPS 13 laptop arrived on February 25th', '2023-02-25'),
        seed('samsung', 'User purchased Samsung Galaxy S22', '2023-02-20'),
      ],
    })
    expect(result.confidence).toBe('high')
    expect(result.ordering?.earliest.thoughtId).toBe('samsung')
    expect(result.ordering?.latest.thoughtId).toBe('dell')
  })

  it('webinar before Effective Time Management workshop', () => {
    const result = solveTemporalQuestion({
      kind: 'ordering',
      entityHints: ['Effective Time Management', 'Data Analysis using Python'],
      hintBindings: hintBindings([
        ['Effective Time Management', 'workshop'],
        ['Data Analysis using Python', 'webinar'],
      ]),
      seeds: [
        seed('webinar', 'Participated in Data Analysis using Python webinar', '2023-03-28'),
        seed('workshop', 'Workshop on Effective Time Management at community center', '2023-05-27'),
      ],
    })
    expect(result.ordering?.earliest.thoughtId).toBe('webinar')
    expect(result.ordering?.latest.thoughtId).toBe('workshop')
  })

  it('tomatoes before marigolds', () => {
    const result = solveTemporalQuestion({
      kind: 'ordering',
      entityHints: ['tomatoes', 'marigolds'],
      hintBindings: hintBindings([
        ['tomatoes', 'f859cd45'],
        ['marigolds', '7a92186a'],
      ]),
      seeds: [
        seed('f859cd45', 'Starting tomato seeds indoors since February 20th', '2023-02-20'),
        seed('7a92186a', 'Marigold seeds arrived and began germinating', '2023-03-03'),
      ],
    })
    expect(result.ordering?.earliest.thoughtId).toBe('f859cd45')
    expect(result.ordering?.latest.thoughtId).toBe('7a92186a')
  })
})

describe('solveTemporalQuestion duration', () => {
  it('workshop to team meeting = 7 days', () => {
    const result = solveTemporalQuestion({
      kind: 'duration',
      entityHints: ['Effective Communication in the Workplace', 'team meeting'],
      hintBindings: hintBindings([
        ['Effective Communication in the Workplace', 'b84f3fdc'],
        ['team meeting', '96797297'],
      ]),
      seeds: [
        seed('b84f3fdc', 'Workshop on Effective Communication in the Workplace', '2023-01-10'),
        seed('96797297', 'Team meeting scheduled', '2023-01-17'),
      ],
    })
    expect(result.kind).toBe('duration')
    expect(result.durationDays?.exclusive).toBe(7)
  })

  it('Rachel start to house loved = 14 exclusive', () => {
    const result = solveTemporalQuestion({
      kind: 'duration',
      entityHints: ['Rachel', 'house they loved'],
      hintBindings: hintBindings([
        ['Rachel', '5edd1f50'],
        ['house they loved', '2a2b2686'],
      ]),
      seeds: [
        seed('5edd1f50', 'Started working with Rachel', '2022-02-15'),
        seed('2a2b2686', 'Saw a house they loved', '2022-03-01'),
      ],
    })
    expect(result.durationDays?.exclusive).toBe(14)
    expect(result.durationDays?.inclusive).toBe(15)
  })
})

describe('solveTemporalQuestion German ordering', () => {
  it('orders Fahrrad before Auto when LLM bindings map German hints to events', () => {
    const result = solveTemporalQuestion({
      kind: 'ordering',
      entityHints: ['Fahrrad', 'Auto'],
      hintBindings: hintBindings([
        ['Fahrrad', 'bike'],
        ['Auto', 'car'],
      ]),
      seeds: [
        seed('bike', 'Fahrradreparatur Mitte Februar', '2023-02-15'),
        seed('car', 'Autowäsche für Toyota Corolla am 27. Februar', '2023-02-27'),
      ],
    })
    expect(result.confidence).toBe('high')
    expect(result.ordering?.earliest.thoughtId).toBe('bike')
  })
})

describe('formatSolverAnswer', () => {
  it('emits deterministic ordering answer', () => {
    const result = solveTemporalQuestion({
      kind: 'ordering',
      entityHints: ['tomatoes', 'marigolds'],
      hintBindings: hintBindings([
        ['tomatoes', 'f859cd45'],
        ['marigolds', '7a92186a'],
      ]),
      seeds: [
        seed('f859cd45', 'Starting tomato seeds indoors since February 20th', '2023-02-20'),
        seed('7a92186a', 'Marigold seeds arrived and began germinating', '2023-03-03'),
      ],
    })
    const answer = formatSolverAnswer(result)
    expect(answer).toMatch(/tomato.*came first/i)
    expect(answer).toContain('[id=computed]')
    expect(answer).toContain('f859cd45')
  })

  it('emits deterministic duration answer', () => {
    const result = solveTemporalQuestion({
      kind: 'duration',
      entityHints: ['Rachel', 'house they loved'],
      hintBindings: hintBindings([
        ['Rachel', '5edd1f50'],
        ['house they loved', '2a2b2686'],
      ]),
      seeds: [
        seed('5edd1f50', 'Started working with Rachel', '2022-02-15'),
        seed('2a2b2686', 'Saw a house they loved', '2022-03-01'),
        seed('mortgage', 'User got pre-approved for a mortgage', '2022-02-10'),
        seed('offer', 'User will submit the offer today', '2022-03-02'),
      ],
    })
    const answer = formatSolverAnswer(result)
    expect(answer).toContain('14 calendar days')
    expect(answer).toContain('Rachel')
  })
})

describe('seedsToTimelineEvents', () => {
  it('sorts chronologically', () => {
    const events = seedsToTimelineEvents([
      seed('b', 'later', '2023-03-01'),
      seed('a', 'earlier', '2023-01-01'),
    ])
    expect(events.map((e) => e.thoughtId)).toEqual(['a', 'b'])
  })
})

describe('formatComputedTimelineForPrompt', () => {
  it('documents the computed citation token for high-confidence results', () => {
    const result = solveTemporalQuestion({
      kind: 'duration',
      entityHints: ['Effective Communication in the Workplace', 'team meeting'],
      hintBindings: hintBindings([
        ['Effective Communication in the Workplace', 'b84f3fdc'],
        ['team meeting', '96797297'],
      ]),
      seeds: [
        seed('b84f3fdc', 'Workshop on Effective Communication in the Workplace', '2023-01-10'),
        seed('96797297', 'Team meeting scheduled', '2023-01-17'),
      ],
    })
    expect(allowsComputedTimelineCitation(result)).toBe(true)
    const block = formatComputedTimelineForPrompt(result)
    expect(block).toContain(`[id=${COMPUTED_TIMELINE_CITATION_ID}]`)
    expect(block).toContain('7 calendar days')
  })
})

describe('low confidence fallthrough', () => {
  it('returns unsupported when only one event', () => {
    const result: TemporalSolverResult = solveTemporalQuestion({
      kind: 'duration',
      entityHints: ['a', 'b'],
      hintBindings: hintBindings([
        ['a', 'only'],
        ['b', 'missing'],
      ]),
      seeds: [seed('only', 'single event', '2023-01-01')],
    })
    expect(result.confidence).toBe('low')
    expect(result.kind).toBe('unsupported')
  })

  it('does not fall back to unrelated events when LLM bindings are incomplete', () => {
    const result = solveTemporalQuestion({
      kind: 'duration',
      entityHints: ['Rachel', 'house they loved'],
      hintBindings: [],
      seeds: [
        seed('mortgage', 'User got pre-approved for a mortgage', '2022-02-10'),
        seed('offer', 'User will submit the offer today', '2022-03-02'),
      ],
    })
    expect(result.confidence).toBe('low')
    expect(result.kind).toBe('unsupported')
  })
})

describe('solveTemporalQuestion count', () => {
  it('counts events before anchor', () => {
    const result = solveTemporalQuestion({
      kind: 'count',
      entityHints: ['Run for the Cure'],
      hintBindings: hintBindings([['Run for the Cure', 'run']]),
      seeds: [
        seed('walk', 'Walk for Hunger charity 5K on February 21st', '2023-02-21'),
        seed('coastal', 'Coastal Cleanup charity event on March 7th', '2023-03-07'),
        seed('dance', 'Dance for a Cause charity event on May 1st', '2023-05-01'),
        seed('golf', 'Charity golf tournament on July 17th', '2023-07-17'),
        seed('run', 'Run for the Cure event on October 15th', '2023-10-15'),
      ],
    })
    expect(result.confidence).toBe('high')
    expect(result.count?.value).toBe(4)
  })
})

describe('solveTemporalQuestion lookback', () => {
  it('computes months ago from reference time', () => {
    const result = solveTemporalQuestion({
      kind: 'lookback',
      entityHints: ['Airbnb in San Francisco'],
      hintBindings: hintBindings([['Airbnb in San Francisco', 'book']]),
      seeds: [seed('book', 'Booked Airbnb in Haight-Ashbury for wedding', '2022-12-27')],
      referenceTime: new Date('2023-05-27T01:55:00.000Z'),
      durationUnit: 'months',
    })
    expect(result.confidence).toBe('high')
    expect(result.lookback?.value).toBe(5)
  })
})

describe('solveTemporalQuestion span', () => {
  it('computes years and months between career milestones', () => {
    const result = solveTemporalQuestion({
      kind: 'span',
      entityHints: ['working professionally', 'NovaTech'],
      hintBindings: hintBindings([
        ['working professionally', 'career'],
        ['NovaTech', 'nova'],
      ]),
      seeds: [
        seed('career', 'Started working professionally', '2014-05-01'),
        seed('nova', 'Started working at NovaTech', '2019-02-01'),
      ],
    })
    expect(result.confidence).toBe('high')
    expect(result.span?.years).toBe(4)
    expect(result.span?.months).toBe(9)
  })
})

describe('calendarMonthsBetweenExclusive', () => {
  it('Dec 27 to May 27 = 5 months', () => {
    expect(
      calendarMonthsBetweenExclusive(
        new Date('2022-12-27T00:00:00.000Z'),
        new Date('2023-05-27T00:00:00.000Z'),
      ),
    ).toBe(5)
  })
})

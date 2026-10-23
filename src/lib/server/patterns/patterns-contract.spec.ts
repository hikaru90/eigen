import { describe, expect, it } from 'vitest'
import {
  INSIGHT_MAX_LENGTH,
  PATTERNS_MAX_COUNT,
  PATTERN_DISTILLATION_MAX_LENGTH,
  PATTERN_MAX_THOUGHT_IDS,
  PATTERN_TITLE_MAX_LENGTH,
  PatternsContractError,
  validatePatternsPayload,
} from './patterns-contract'

const KNOWN_IDS = new Set(['t-1', 't-2', 't-3', 't-4'])

function validPayload() {
  return {
    insight: 'Lately, you keep returning to the studio rebuild.',
    patterns: [
      {
        title: 'Studio rebuild',
        distillation: 'Six thoughts about rebuilding the studio in the last two weeks.',
        kind: 'growing',
        thoughtIds: ['t-1', 't-2'],
      },
    ],
  }
}

describe('validatePatternsPayload', () => {
  it('accepts a valid payload and returns typed patterns', () => {
    const result = validatePatternsPayload(validPayload(), KNOWN_IDS)
    expect(result.insight).toBe('Lately, you keep returning to the studio rebuild.')
    expect(result.patterns).toEqual([
      {
        title: 'Studio rebuild',
        distillation: 'Six thoughts about rebuilding the studio in the last two weeks.',
        kind: 'growing',
        thoughtIds: ['t-1', 't-2'],
      },
    ])
  })

  it('trims strings and clamps them to the contract maxima', () => {
    const raw = validPayload()
    raw.insight = `  ${'x'.repeat(INSIGHT_MAX_LENGTH + 50)}  `
    raw.patterns[0].title = `  ${'t'.repeat(PATTERN_TITLE_MAX_LENGTH + 10)}  `
    raw.patterns[0].distillation = 'd'.repeat(PATTERN_DISTILLATION_MAX_LENGTH + 30)
    const result = validatePatternsPayload(raw, KNOWN_IDS)
    expect(result.insight.length).toBe(INSIGHT_MAX_LENGTH)
    expect(result.patterns[0].title.length).toBe(PATTERN_TITLE_MAX_LENGTH)
    expect(result.patterns[0].distillation.length).toBe(PATTERN_DISTILLATION_MAX_LENGTH)
  })

  it('caps the pattern list at PATTERNS_MAX_COUNT', () => {
    const raw = validPayload()
    raw.patterns = Array.from({ length: PATTERNS_MAX_COUNT + 3 }, (_, i) => ({
      title: `Pattern ${i}`,
      distillation: 'distillation',
      kind: 'recurring',
      thoughtIds: ['t-1'],
    }))
    const result = validatePatternsPayload(raw, KNOWN_IDS)
    expect(result.patterns.length).toBe(PATTERNS_MAX_COUNT)
    expect(result.patterns[0].title).toBe('Pattern 0')
  })

  it('binds thoughtIds to the passed catalog: unknown ids dropped, dupes removed, order kept', () => {
    const raw = validPayload()
    raw.patterns[0].thoughtIds = ['t-2', 'ghost-9', 't-1', 't-2', 42, 't-3']
    const result = validatePatternsPayload(raw, KNOWN_IDS)
    expect(result.patterns[0].thoughtIds).toEqual(['t-2', 't-1', 't-3'])
  })

  it('caps thoughtIds per pattern at PATTERN_MAX_THOUGHT_IDS', () => {
    const manyKnown = new Set(Array.from({ length: 30 }, (_, i) => `t-${i}`))
    const raw = validPayload()
    raw.patterns[0].thoughtIds = [...manyKnown]
    const result = validatePatternsPayload(raw, manyKnown)
    expect(result.patterns[0].thoughtIds.length).toBe(PATTERN_MAX_THOUGHT_IDS)
    expect(result.patterns[0].thoughtIds[0]).toBe('t-0')
  })

  it('drops patterns whose thoughtIds are all unknown, keeping the rest in order', () => {
    const raw = validPayload()
    raw.patterns = [
      { title: 'Empty', distillation: 'references nothing real', kind: 'fading', thoughtIds: ['nope'] },
      { title: 'Real', distillation: 'references real thoughts', kind: 'recurring', thoughtIds: ['t-4'] },
    ]
    const result = validatePatternsPayload(raw, KNOWN_IDS)
    expect(result.patterns.length).toBe(1)
    expect(result.patterns[0].title).toBe('Real')
  })

  it('allows a payload with zero patterns (insight only)', () => {
    const raw = validPayload()
    raw.patterns = []
    const result = validatePatternsPayload(raw, KNOWN_IDS)
    expect(result.patterns).toEqual([])
  })

  it('drops a later pattern whose title repeats an earlier one (titles key the cards)', () => {
    const raw = validPayload()
    raw.patterns = [
      { title: 'Studio rebuild', distillation: 'first', kind: 'growing', thoughtIds: ['t-1'] },
      { title: 'Studio rebuild', distillation: 'second, same name', kind: 'recurring', thoughtIds: ['t-2'] },
      { title: 'Slowness', distillation: 'third', kind: 'recurring', thoughtIds: ['t-3'] },
    ]
    const result = validatePatternsPayload(raw, KNOWN_IDS)
    expect(result.patterns.map((pattern) => pattern.title)).toEqual(['Studio rebuild', 'Slowness'])
    expect(result.patterns[0].distillation).toBe('first')
  })

  it('throws PatternsContractError when the payload is not an object', () => {
    expect(() => validatePatternsPayload(null, KNOWN_IDS)).toThrow(PatternsContractError)
    expect(() => validatePatternsPayload('nope', KNOWN_IDS)).toThrow(PatternsContractError)
    expect(() => validatePatternsPayload([], KNOWN_IDS)).toThrow(PatternsContractError)
  })

  it('throws when insight is missing, empty or not a string', () => {
    for (const insight of [undefined, null, '', '   ', 7]) {
      const raw = validPayload()
      ;(raw as Record<string, unknown>).insight = insight
      expect(() => validatePatternsPayload(raw, KNOWN_IDS)).toThrow(PatternsContractError)
    }
  })

  it('throws when patterns is missing or not an array', () => {
    for (const patterns of [undefined, null, 'nope', {}]) {
      const raw = validPayload()
      ;(raw as Record<string, unknown>).patterns = patterns
      expect(() => validatePatternsPayload(raw, KNOWN_IDS)).toThrow(PatternsContractError)
    }
  })

  it('throws when an entry is not an object or misses required string fields', () => {
    const cases: unknown[] = [
      'a string',
      null,
      {},
      { title: '', distillation: 'd', kind: 'growing', thoughtIds: [] },
      { title: 'T', distillation: '', kind: 'growing', thoughtIds: [] },
      { title: 'T', distillation: 'd', kind: 'growing' },
    ]
    for (const pattern of cases) {
      const raw = validPayload()
      raw.patterns = [pattern as (typeof raw.patterns)[number]]
      expect(() => validatePatternsPayload(raw, KNOWN_IDS)).toThrow(PatternsContractError)
    }
  })

  it('throws when kind is outside the contract enum — no silent retyping', () => {
    const raw = validPayload()
    raw.patterns[0].kind = 'vibes'
    expect(() => validatePatternsPayload(raw, KNOWN_IDS)).toThrow(PatternsContractError)
  })

  it('throws when thoughtIds is missing or not an array', () => {
    for (const thoughtIds of [undefined, null, 't-1', {}]) {
      const raw = validPayload()
      raw.patterns[0].thoughtIds = thoughtIds as (typeof raw.patterns)[number]['thoughtIds']
      expect(() => validatePatternsPayload(raw, KNOWN_IDS)).toThrow(PatternsContractError)
    }
  })

  it('accepts every kind from the contract enum', () => {
    for (const kind of ['recurring', 'scattered', 'growing', 'fading'] as const) {
      const raw = validPayload()
      raw.patterns[0].kind = kind
      const result = validatePatternsPayload(raw, KNOWN_IDS)
      expect(result.patterns[0].kind).toBe(kind)
    }
  })
})

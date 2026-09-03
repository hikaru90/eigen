import { describe, expect, it } from 'vitest'
import type {
  LoadedUserOntology,
  OntologyEntityKindRow,
} from '$lib/server/ontology-db/load-ontology'
import {
  buildStrictCategoryRetryPrompt,
  InvalidThoughtCategoryError,
  resolveCategoryFromLlmOutput,
} from './validate-thought-category'

function kind(key: string, overrides: Partial<OntologyEntityKindRow> = {}): OntologyEntityKindRow {
  return {
    id: `ek-${key}`,
    userId: 'u1',
    key,
    name: key,
    definition: '',
    active: true,
    kindType: 'thought_category',
    neverStale: false,
    ...overrides,
  }
}

function makeLoaded(kinds: OntologyEntityKindRow[]): LoadedUserOntology {
  return {
    entityKinds: kinds,
    relationKinds: [],
    entityKindsById: new Map(kinds.map((k) => [k.id, k])),
    entityKindsByKey: new Map(kinds.map((k) => [k.key, k])),
    relationKindsById: new Map(),
    relationKindsByKey: new Map(),
  }
}

const loaded = makeLoaded([
  kind('observation'),
  kind('task'),
  kind('decision', { neverStale: true }),
  kind('perception', { active: false }), // deactivated legacy kind — never valid for new ingest
])

describe('resolveCategoryFromLlmOutput', () => {
  it('accepts a valid primary key with clamped confidence', () => {
    const resolved = resolveCategoryFromLlmOutput(loaded, {
      key: 'task',
      confidence: 1.7,
      alternatives: [],
    })
    expect(resolved.key).toBe('task')
    expect(resolved.ontologyEntityKindId).toBe('ek-task')
    expect(resolved.confidence).toBe(1)
    expect(resolved.repairedFrom).toBeUndefined()
  })

  it('trims whitespace around the primary key', () => {
    const resolved = resolveCategoryFromLlmOutput(loaded, { key: '  observation\n' })
    expect(resolved.key).toBe('observation')
  })

  it('repairs an invalid primary by promoting the top valid alternative (AC-1)', () => {
    const resolved = resolveCategoryFromLlmOutput(loaded, {
      key: 'perception', // deactivated — invalid for new ingest
      confidence: 0.9,
      alternatives: [
        { key: 'not-a-kind', confidence: 0.8 }, // invalid — skipped
        { key: 'observation', confidence: 0.7 },
        { key: 'task', confidence: 0.2 },
      ],
    })
    expect(resolved.key).toBe('observation')
    expect(resolved.confidence).toBe(0.7)
    expect(resolved.repairedFrom).toBe('perception')
    expect(resolved.alternatives.map((a) => a.key)).toEqual(['observation', 'task'])
  })

  it('throws InvalidThoughtCategoryError when nothing valid remains (AC-2 trigger)', () => {
    expect(() =>
      resolveCategoryFromLlmOutput(loaded, {
        key: 'episode', // memoryType-era label — not a thought category
        alternatives: [{ key: 'also-invalid', confidence: 0.5 }],
      }),
    ).toThrow(InvalidThoughtCategoryError)
  })

  it('throws when the output is not an object or the key is missing', () => {
    expect(() => resolveCategoryFromLlmOutput(loaded, null)).toThrow(InvalidThoughtCategoryError)
    expect(() => resolveCategoryFromLlmOutput(loaded, { confidence: 0.5 })).toThrow(
      InvalidThoughtCategoryError,
    )
  })

  it('defaults a missing confidence to 0.5 for valid primary keys', () => {
    const resolved = resolveCategoryFromLlmOutput(loaded, { key: 'task' })
    expect(resolved.confidence).toBe(0.5)
  })
})

describe('buildStrictCategoryRetryPrompt', () => {
  it('lists only allowed keys and never repeats the rejected key', () => {
    const prompt = buildStrictCategoryRetryPrompt({
      normalizedText: 'Buy milk',
      allowedKeys: ['task', 'observation'],
    })
    expect(prompt).toContain('Buy milk')
    expect(prompt).toContain('observation, task')
    expect(prompt).not.toContain('perception')
    expect(prompt).not.toContain('episode')
  })
})

import type { PersonaQueries } from './load-dataset'
import type { PreparedRow } from './types'
import { describe, expect, it } from 'vitest'
import { selectValPersonas, summarizeValPersonas, valHistoryLinks } from './val-personas'

const persona = (personaId: number): PersonaQueries => ({
  personaId,
  historyPath: `/data/dir/data/chat_history_32k/chat_history_x_persona${personaId}.json`,
  queries: [{ personaId } as PreparedRow],
})
const pool = (ids: number[]) => ids.map(persona)
const ids = (personas: PersonaQueries[]) => personas.map((p) => p.personaId)

describe('selectValPersonas', () => {
  const val = pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

  it('never picks a benchmark persona', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const picked = ids(selectValPersonas(val, new Set([1, 2, 3, 4, 5, 6]), 6, seed))
      expect(picked.sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12])
    }
  })

  it('is deterministic for a seed and does not depend on the order of the input', () => {
    const a = ids(selectValPersonas(val, new Set([3]), 5, 'val-full-1'))
    const b = ids(selectValPersonas([...val].reverse(), new Set([3]), 5, 'val-full-1'))
    expect(b).toEqual(a)
    expect(ids(selectValPersonas(val, new Set([3]), 5, 'val-full-1'))).toEqual(a)
  })

  it('a different seed picks a different set', () => {
    const sets = new Set(
      ['s1', 's2', 's3', 's4'].map((s) => ids(selectValPersonas(val, new Set(), 4, s)).join(',')),
    )
    expect(sets.size).toBeGreaterThan(1)
  })

  it('returns the picked personas in ascending id order', () => {
    const picked = ids(selectValPersonas(val, new Set(), 7, 'order'))
    expect(picked).toEqual([...picked].sort((a, b) => a - b))
  })

  it('fails loud when fewer personas are eligible than asked for', () => {
    expect(() => selectValPersonas(val, new Set([1, 2, 3, 4, 5, 6, 7, 8]), 5, 'x')).toThrow(
      /only 4 .* eligible/,
    )
  })

  it('fails loud on a blank seed', () => {
    expect(() => selectValPersonas(val, new Set(), 2, ' ')).toThrow(/seed/)
  })
})

describe('valHistoryLinks', () => {
  it('gives the dataset-relative link of each persona history file', () => {
    const links = valHistoryLinks('/data/dir', [persona(5), persona(2)])
    expect(links).toEqual([
      {
        personaId: 5,
        link: 'data/chat_history_32k/chat_history_x_persona5.json',
      },
      {
        personaId: 2,
        link: 'data/chat_history_32k/chat_history_x_persona2.json',
      },
    ])
  })

  it('refuses a history path outside the data dir', () => {
    expect(() => valHistoryLinks('/other', [persona(1)])).toThrow(/outside the data dir/)
  })
})

describe('summarizeValPersonas', () => {
  it('counts questions and the pref_type mix, with sorted keys', () => {
    const q = (prefType: string) => ({ prefType }) as PreparedRow
    const summary = summarizeValPersonas([
      { ...persona(3), queries: [q('b'), q('a')] },
      { ...persona(1), queries: [q('b')] },
    ])
    expect(summary).toEqual({
      personaIds: [1, 3],
      questions: 3,
      prefTypeCounts: { a: 1, b: 2 },
    })
  })
})

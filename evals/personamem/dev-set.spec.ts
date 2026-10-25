import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDevSetFile,
  DEV_SET_RULE,
  devSetForDataDir,
  loadDevSet,
  parseDevSet,
  selectDevSet,
  type DevSetCandidate,
} from './dev-set'
import { preparedFilename } from './load-dataset'

/** Real val.csv pref_type mix (2,061 rows), spread over personas with up to 9 rows each. */
const MIX: Record<string, number> = {
  ask_to_forget: 420,
  anti_stereotypical_pref: 375,
  neutral_preferences: 355,
  therapy_background: 254,
  health_and_medical_conditions: 249,
  stereotypical_pref: 224,
  sensitive_info: 184,
}
const PERSONAS = 735

function hex12(n: number): string {
  return n.toString(16).padStart(12, '0')
}

function synthetic(mix: Record<string, number> = MIX, personas = PERSONAS): DevSetCandidate[] {
  const rows: DevSetCandidate[] = []
  let n = 0
  for (const [prefType, count] of Object.entries(mix)) {
    for (let i = 0; i < count; i++) {
      const personaId = (n * 7) % personas
      rows.push({ questionId: `p${personaId}-${hex12(n)}`, personaId, prefType })
      n++
    }
  }
  return rows
}

const options = {
  seed: 'dev-set-test',
  size: 60,
  minPerPrefType: 4,
  maxPerPersona: 2,
  excludePersonaIds: [] as number[],
}

function countBy<T>(items: T[], key: (item: T) => string | number): Map<string | number, number> {
  const out = new Map<string | number, number>()
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1)
  return out
}

describe('selectDevSet', () => {
  const rows = synthetic()
  const selected = selectDevSet(rows, options)
  const byId = new Map(rows.map((r) => [r.questionId, r]))

  it('returns exactly `size` distinct questions that exist in the data', () => {
    expect(selected.questionIds).toHaveLength(60)
    expect(new Set(selected.questionIds).size).toBe(60)
    for (const id of selected.questionIds) expect(byId.has(id)).toBe(true)
  })

  it('represents every pref_type, ask_to_forget included, at least minPerPrefType times', () => {
    const counts = countBy(
      selected.questionIds.map((id) => byId.get(id)!),
      (r) => r.prefType,
    )
    expect([...counts.keys()].sort()).toEqual(Object.keys(MIX).sort())
    for (const n of counts.values()) expect(n).toBeGreaterThanOrEqual(4)
    expect(counts.get('ask_to_forget')).toBeGreaterThanOrEqual(4)
  })

  it('allocates proportionally to the pref_type shares (largest remainder)', () => {
    const total = rows.length
    for (const [prefType, quota] of Object.entries(selected.prefTypeCounts)) {
      const exact = (MIX[prefType]! / total) * 60
      expect(Math.abs(quota - exact)).toBeLessThan(1)
    }
    expect(Object.values(selected.prefTypeCounts).reduce((a, b) => a + b, 0)).toBe(60)
    expect(selected.prefTypeCounts.ask_to_forget).toBeGreaterThan(
      selected.prefTypeCounts.sensitive_info!,
    )
  })

  it('takes at most maxPerPersona questions per persona', () => {
    const perPersona = countBy(
      selected.questionIds.map((id) => byId.get(id)!),
      (r) => r.personaId,
    )
    expect(Math.max(...perPersona.values())).toBeLessThanOrEqual(2)
  })

  it('never takes a question of an excluded persona', () => {
    const excluded = [...new Set(rows.slice(0, 40).map((r) => r.personaId))]
    const result = selectDevSet(rows, { ...options, excludePersonaIds: excluded })
    for (const id of result.questionIds) expect(excluded).not.toContain(byId.get(id)!.personaId)
  })

  it('is deterministic: same seed, same ids, whatever the input row order', () => {
    const again = selectDevSet([...rows].reverse(), options)
    expect(again.questionIds).toEqual(selected.questionIds)
    expect(selectDevSet(rows, options).questionIds).toEqual(selected.questionIds)
  })

  it('a different seed picks different questions', () => {
    const other = selectDevSet(rows, { ...options, seed: 'another-seed' })
    expect(other.questionIds).not.toEqual(selected.questionIds)
  })

  it('lifts a rare pref_type to the minimum and takes the seats from the largest ones', () => {
    const rare = synthetic({ common_a: 600, common_b: 380, rare: 20 })
    const result = selectDevSet(rare, options)
    expect(result.prefTypeCounts.rare).toBe(4)
    expect(Object.values(result.prefTypeCounts).reduce((a, b) => a + b, 0)).toBe(60)
    expect(result.prefTypeCounts.common_a).toBeGreaterThan(result.prefTypeCounts.common_b!)
  })

  it('lists the ids in a stable sorted order', () => {
    expect([...selected.questionIds].sort()).toEqual(selected.questionIds)
  })

  it('fails loud when asked for more questions than exist', () => {
    expect(() => selectDevSet(synthetic({ a: 5, b: 5 }), options)).toThrow(/60/)
  })

  it('fails loud when a pref_type has fewer rows than its minimum', () => {
    expect(() => selectDevSet(synthetic({ big: 900, tiny: 3 }), options)).toThrow(/tiny/)
  })

  it('fails loud when size cannot hold the minimum for every pref_type', () => {
    expect(() => selectDevSet(rows, { ...options, size: 20 })).toThrow(/minPerPrefType/)
  })

  it('fails loud when the per-persona cap leaves a pref_type short', () => {
    const onePersona = Array.from({ length: 120 }, (_, i) => ({
      questionId: `p1-${hex12(i)}`,
      personaId: 1,
      prefType: i % 2 === 0 ? 'a' : 'b',
    }))
    expect(() => selectDevSet(onePersona, { ...options, size: 8 })).toThrow(/per-persona cap/)
  })

  it.each([
    ['seed', { seed: ' ' }],
    ['size', { size: 0 }],
    ['maxPerPersona', { maxPerPersona: 0 }],
    ['minPerPrefType', { minPerPrefType: 0 }],
  ])('rejects an invalid %s', (name, patch) => {
    expect(() => selectDevSet(rows, { ...options, ...patch })).toThrow(new RegExp(name))
  })

  it('rejects duplicate question ids in the input', () => {
    expect(() => selectDevSet([...rows, rows[0]!], options)).toThrow(/duplicate/)
  })
})

describe('dev-set file', () => {
  const rows = synthetic()
  const file = buildDevSetFile(rows, { ...options, excludePersonaIds: [78, 3] })

  it('records split, seed, selection rule, parameters, exclusions and counts next to the ids', () => {
    expect(file).toMatchObject({
      benchmark: 'personamem-v2',
      split: 'val',
      seed: 'dev-set-test',
      rule: DEV_SET_RULE,
      size: 60,
      minPerPrefType: 4,
      maxPerPersona: 2,
      excludedPersonaIds: [3, 78],
    })
    expect(file.questionIds).toHaveLength(60)
    expect(Object.values(file.prefTypeCounts).reduce((a, b) => a + b, 0)).toBe(60)
    expect(DEV_SET_RULE).toMatch(/seed/i)
    expect(DEV_SET_RULE).toMatch(/pref_type/)
  })

  it('round-trips through JSON and the validating parser', () => {
    expect(parseDevSet(JSON.parse(JSON.stringify(file)), 'x.json')).toEqual(file)
  })

  it('loads from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-set-'))
    const path = join(dir, 'dev.json')
    writeFileSync(path, JSON.stringify(file))
    expect(loadDevSet(path)).toEqual(file)
  })

  it('names the path when the file is missing or not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-set-'))
    expect(() => loadDevSet(join(dir, 'nope.json'))).toThrow(/nope\.json/)
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, 'not json')
    expect(() => loadDevSet(bad)).toThrow(/bad\.json/)
  })

  it('rejects a file whose id count differs from its size, with duplicates, or a malformed id', () => {
    const base = JSON.parse(JSON.stringify(file)) as Record<string, unknown>
    const ids = file.questionIds
    expect(() => parseDevSet({ ...base, questionIds: ids.slice(1) }, 'x')).toThrow(/size/)
    expect(() => parseDevSet({ ...base, questionIds: [ids[0], ...ids.slice(0, 59)] }, 'x')).toThrow(
      /duplicate/,
    )
    expect(() => parseDevSet({ ...base, questionIds: [...ids.slice(1), 'nope'] }, 'x')).toThrow(
      /questionIds/,
    )
  })

  it('rejects an unknown extra field (strict) and a missing seed', () => {
    const base = JSON.parse(JSON.stringify(file)) as Record<string, unknown>
    expect(() => parseDevSet({ ...base, extra: 1 }, 'x')).toThrow()
    const { seed: _seed, ...noSeed } = base
    expect(() => parseDevSet(noSeed, 'x')).toThrow(/seed/)
  })
})

describe('devSetForDataDir', () => {
  const prepared = (personaId: number, n: number, prefType: string) => ({
    personaId,
    historyPath: `/h/${personaId}.json`,
    query: `q${personaId}-${n}`,
    correctAnswer: 'right',
    incorrectAnswers: ['a', 'b', 'c'],
    prefType,
    who: 'self',
    updated: false,
    prevPref: null,
    scenario: 's',
    topicQuery: 't',
    distance32k: 1,
    questionId: `p${personaId}-${hex12(personaId * 100 + n)}`,
    preference: 'p',
    evidenceTurns: [{ role: 'user', content: 'x' }],
  })

  function dataDirWith(val: unknown[], benchmark: unknown[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'dev-set-data-'))
    const write = (split: 'val' | 'benchmark', rows: unknown[]) =>
      writeFileSync(
        join(dir, preparedFilename(split)),
        rows.map((r) => JSON.stringify(r)).join('\n'),
      )
    write('val', val)
    write('benchmark', benchmark)
    return dir
  }

  it('selects from val and leaves out every persona that is also in the benchmark split', () => {
    const val = [1, 2, 3, 4, 5, 6].flatMap((p) => [
      prepared(p, 0, p % 2 ? 'odd' : 'even'),
      prepared(p, 1, p % 2 ? 'odd' : 'even'),
    ])
    const dir = dataDirWith(val, [prepared(1, 9, 'odd'), prepared(2, 9, 'even')])
    const file = devSetForDataDir(dir, {
      seed: 's',
      size: 4,
      minPerPrefType: 2,
      maxPerPersona: 1,
    })
    expect(file.excludedPersonaIds).toEqual([1, 2])
    expect(file.split).toBe('val')
    expect(file.questionIds).toHaveLength(4)
    for (const id of file.questionIds) expect(id).not.toMatch(/^p[12]-/)
  })

  it('fails loud when the benchmark file is missing (the exclusion cannot be checked)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-set-data-'))
    writeFileSync(join(dir, preparedFilename('val')), JSON.stringify(prepared(1, 0, 'a')))
    expect(() =>
      devSetForDataDir(dir, { seed: 's', size: 1, minPerPrefType: 1, maxPerPersona: 1 }),
    ).toThrow(/personamem\.benchmark\.jsonl/)
  })
})

describe('committed dev-set.val.json', () => {
  const file = loadDevSet(join(import.meta.dirname, 'dev-set.val.json'))

  it('is a valid val dev set of 60 questions with the recorded seed and rule', () => {
    expect(file).toMatchObject({ split: 'val', size: 60, rule: DEV_SET_RULE })
    expect(file.seed.trim()).not.toBe('')
  })

  it('represents every pref_type at least 4 times, ask_to_forget included', () => {
    expect(Object.keys(file.prefTypeCounts)).toContain('ask_to_forget')
    for (const n of Object.values(file.prefTypeCounts)) expect(n).toBeGreaterThanOrEqual(4)
  })

  it('leaves out persona 78, which is also a benchmark persona', () => {
    expect(file.excludedPersonaIds).toContain(78)
    expect(file.questionIds.filter((id) => id.startsWith('p78-'))).toEqual([])
  })

  it('takes at most 2 questions per persona', () => {
    const perPersona = countBy(file.questionIds, (id) => id.split('-')[0]!)
    expect(Math.max(...perPersona.values())).toBeLessThanOrEqual(2)
  })
})

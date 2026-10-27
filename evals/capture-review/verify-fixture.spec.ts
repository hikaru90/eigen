import { describe, expect, it } from 'vitest'
import { loadVerifyCases, parseVerifyCases, VERIFY_CASES_PATH } from './verify-fixture'

const base = { text: 'call Mom on Friday', capturedAt: '2026-10-27T10:00:00+01:00' }

describe('parseVerifyCases', () => {
  it('reads clean cases and mistake cases, with the capture time as a Date', () => {
    const cases = parseVerifyCases([
      { id: 'a_clean', ...base },
      { id: 'b_bad', ...base, mutation: { type: 'shift_date', days: 1 } },
    ])
    expect(cases.map((c) => [c.id, c.kind])).toEqual([
      ['a_clean', 'clean'],
      ['b_bad', 'mistake'],
    ])
    expect(cases[0].capturedAtDate.toISOString()).toBe('2026-10-27T09:00:00.000Z')
    expect(cases[0].mutation).toBeNull()
    expect(cases[1].mutation).toEqual({ type: 'shift_date', days: 1 })
  })

  it('rejects a non-list, an empty list and a list with no clean or no mistake case', () => {
    expect(() => parseVerifyCases({})).toThrow(/list/)
    expect(() => parseVerifyCases([])).toThrow(/at least one/)
    expect(() => parseVerifyCases([{ id: 'a', ...base }])).toThrow(/mistake case/)
    expect(() =>
      parseVerifyCases([{ id: 'a', ...base, mutation: { type: 'delete_dates' } }]),
    ).toThrow(/clean case/)
  })

  it('rejects duplicate ids, bad ids, blank text and unknown keys', () => {
    const clean = { id: 'a', ...base }
    const bad = { id: 'b', ...base, mutation: { type: 'delete_dates' } }
    expect(() => parseVerifyCases([clean, clean, bad])).toThrow(/duplicate id "a"/)
    expect(() => parseVerifyCases([{ ...clean, id: 'Has Space' }, bad])).toThrow(/id/)
    expect(() => parseVerifyCases([{ ...clean, text: '  ' }, bad])).toThrow(/text/)
    expect(() => parseVerifyCases([{ ...clean, extra: 1 }, bad])).toThrow(/case 1/)
  })

  it('rejects a capture time without an offset or on a day that does not exist', () => {
    const bad = { id: 'b', ...base, mutation: { type: 'delete_dates' } }
    expect(() =>
      parseVerifyCases([{ id: 'a', ...base, capturedAt: '2026-10-27T10:00:00' }, bad]),
    ).toThrow(/capturedAt/)
    expect(() =>
      parseVerifyCases([{ id: 'a', ...base, capturedAt: '2026-02-30T10:00:00Z' }, bad]),
    ).toThrow(/does not exist/)
  })

  it('rejects an invented name that is in the capture, and a wording equal to the capture', () => {
    const clean = { id: 'a', ...base }
    expect(() =>
      parseVerifyCases([
        clean,
        { id: 'b', ...base, mutation: { type: 'add_name', surface: 'mom' } },
      ]),
    ).toThrow(/already in the capture/)
    expect(() =>
      parseVerifyCases([
        clean,
        { id: 'b', ...base, mutation: { type: 'replace_wording', text: ' call Mom on Friday ' } },
      ]),
    ).toThrow(/same as the capture/)
  })
})

describe('the shipped cases', () => {
  const cases = loadVerifyCases(VERIFY_CASES_PATH)

  it('load and cover every mutation kind plus clean captures', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12)
    expect(cases.filter((c) => c.kind === 'clean').length).toBe(4)
    const kinds = new Set(cases.flatMap((c) => (c.mutation ? [c.mutation.type] : [])))
    expect([...kinds].sort()).toEqual(
      [
        'add_name',
        'delete_dates',
        'drop_last_piece',
        'fragment_piece',
        'remove_name',
        'replace_wording',
        'shift_date',
        'shift_time',
      ].sort(),
    )
  })

  it('include German captures among the clean and the mistake cases', () => {
    expect(cases.some((c) => c.id.endsWith('_de') && c.kind === 'clean')).toBe(true)
    expect(cases.some((c) => c.id.endsWith('_de') && c.kind === 'mistake')).toBe(true)
  })
})

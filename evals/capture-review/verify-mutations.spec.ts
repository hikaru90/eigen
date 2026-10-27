import { describe, expect, it } from 'vitest'
import {
  describeMutation,
  fragmentOfPiece,
  mutationSchema,
  mutationTarget,
  PieceMutationError,
  withFragmentPiece,
  withoutLastPiece,
  type Mutation,
} from './verify-mutations'

describe('mutationSchema', () => {
  it('accepts every mutation kind with its parameters', () => {
    const ok: unknown[] = [
      { type: 'shift_date', days: 1 },
      { type: 'shift_time', hours: 3 },
      { type: 'delete_dates' },
      { type: 'add_name', surface: 'Rebecca' },
      { type: 'remove_name' },
      { type: 'replace_wording', text: 'Do it tomorrow.' },
      { type: 'fragment_piece', piece: 1 },
      { type: 'drop_last_piece' },
    ]
    for (const m of ok) expect(mutationSchema.safeParse(m).success).toBe(true)
  })

  it('rejects unknown kinds, extra keys, zero shifts and blank values', () => {
    const bad: unknown[] = [
      { type: 'explode' },
      { type: 'shift_date', days: 0 },
      { type: 'shift_date', days: 1.5 },
      { type: 'shift_time', hours: 24 },
      { type: 'delete_dates', extra: true },
      { type: 'add_name', surface: '  ' },
      { type: 'replace_wording', text: '' },
      { type: 'fragment_piece', piece: 0 },
    ]
    for (const m of bad) expect(mutationSchema.safeParse(m).success).toBe(false)
  })
})

describe('mutationTarget', () => {
  const cases: Array<[Mutation, string, string]> = [
    [{ type: 'shift_date', days: 1 }, 'date', 'wrong'],
    [{ type: 'shift_time', hours: 3 }, 'date', 'wrong'],
    [{ type: 'delete_dates' }, 'missing_dates', 'something_missing'],
    [{ type: 'add_name', surface: 'X' }, 'name', 'wrong'],
    [{ type: 'remove_name' }, 'missing_names', 'something_missing'],
    [{ type: 'replace_wording', text: 'x' }, 'wording', 'wrong'],
    [{ type: 'fragment_piece', piece: 2 }, 'piece', 'wrong'],
    [{ type: 'drop_last_piece' }, 'pieces_cover', 'wrong'],
  ]
  it.each(cases)('%j targets %s with %s', (mutation, part, negativeLabel) => {
    expect(mutationTarget(mutation)).toEqual({ part, negativeLabel })
  })
})

describe('describeMutation', () => {
  it('names the kind and its parameter without any capture text', () => {
    expect(describeMutation({ type: 'shift_date', days: 1 })).toBe('date +1 day')
    expect(describeMutation({ type: 'shift_date', days: -2 })).toBe('date -2 days')
    expect(describeMutation({ type: 'shift_time', hours: 3 })).toBe('time +3 h')
    expect(describeMutation({ type: 'delete_dates' })).toBe('dates deleted')
    expect(describeMutation({ type: 'add_name', surface: 'Rebecca' })).toBe('name invented')
    expect(describeMutation({ type: 'remove_name' })).toBe('name removed')
    expect(describeMutation({ type: 'replace_wording', text: 'secret' })).toBe('wording changed')
    expect(describeMutation({ type: 'fragment_piece', piece: 2 })).toBe('piece 2 cut to a fragment')
    expect(describeMutation({ type: 'drop_last_piece' })).toBe('last piece dropped')
  })
})

describe('piece mutations', () => {
  it('cuts a piece off before its last word, so it ends mid-sentence', () => {
    expect(fragmentOfPiece('return the drill to Ben')).toBe('return the drill to')
    expect(fragmentOfPiece("call the vet about Momo's vaccination")).toBe(
      "call the vet about Momo's",
    )
  })

  it('refuses a piece too short to be cut', () => {
    expect(() => fragmentOfPiece('call Ben')).toThrow(PieceMutationError)
  })

  it('replaces one piece by its 1-based number and leaves the rest', () => {
    const pieces = ['buy stamps now', 'return the drill to Ben', 'call the vet today']
    expect(withFragmentPiece(pieces, 2)).toEqual([
      'buy stamps now',
      'return the drill to',
      'call the vet today',
    ])
    expect(() => withFragmentPiece(pieces, 4)).toThrow(PieceMutationError)
  })

  it('drops the last piece and needs at least two', () => {
    expect(withoutLastPiece(['a b', 'c d', 'e f'])).toEqual(['a b', 'c d'])
    expect(() => withoutLastPiece(['only one'])).toThrow(PieceMutationError)
  })
})

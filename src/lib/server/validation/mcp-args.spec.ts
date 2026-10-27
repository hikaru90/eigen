import { describe, expect, it } from 'vitest'
import {
  readDeleteLookupQueryFromToolArgs,
  readThoughtIdFromToolArgs,
  strictToolArgs,
  tryReadThoughtIdFromToolArgs,
  validateNonEmptyEntityId,
  validateSearchParams,
} from './mcp-args'

describe('validateNonEmptyEntityId', () => {
  it('returns trimmed id', () => {
    expect(validateNonEmptyEntityId('  u1  ', 'user_id')).toBe('u1')
  })

  it('rejects empty', () => {
    expect(() => validateNonEmptyEntityId('   ', 'user_id')).toThrow(/whitespace-only/)
  })

  it('rejects interior whitespace', () => {
    expect(() => validateNonEmptyEntityId('a b', 'user_id')).toThrow(/whitespace/)
  })

  it('rejects null or undefined values explicitly', () => {
    expect(() => validateNonEmptyEntityId(null, 'user_id')).toThrow(/value is required/)
    expect(() => validateNonEmptyEntityId(undefined, 'user_id')).toThrow(/value is required/)
  })
})

describe('readThoughtIdFromToolArgs', () => {
  it('reads thought_id, thoughtId, and id aliases', () => {
    expect(readThoughtIdFromToolArgs({ thought_id: 't1' })).toBe('t1')
    expect(readThoughtIdFromToolArgs({ thoughtId: 't2' })).toBe('t2')
    expect(readThoughtIdFromToolArgs({ id: 't3' })).toBe('t3')
  })

  it('prefers thought_id over id when both are present', () => {
    expect(readThoughtIdFromToolArgs({ thought_id: 'canonical', id: 'other' })).toBe('canonical')
  })

  it('falls back to id when thought_id is whitespace-only', () => {
    expect(readThoughtIdFromToolArgs({ thought_id: '   ', id: 't-fallback' })).toBe('t-fallback')
  })

  it('throws when no usable id key is present', () => {
    expect(() => readThoughtIdFromToolArgs({})).toThrow(/whitespace-only|value is required/)
  })

  it('tryReadThoughtIdFromToolArgs returns null for prose descriptions', () => {
    expect(tryReadThoughtIdFromToolArgs({ thought_id: 'Japanese glazed salmon recipe' })).toBeNull()
    expect(tryReadThoughtIdFromToolArgs({ thought_id: 't1' })).toBe('t1')
  })

  it('readDeleteLookupQueryFromToolArgs returns trimmed lookup text', () => {
    expect(
      readDeleteLookupQueryFromToolArgs({ thought_id: '  Japanese glazed salmon recipe  ' }),
    ).toBe('Japanese glazed salmon recipe')
    expect(readDeleteLookupQueryFromToolArgs({})).toBeNull()
  })
})

describe('validateSearchParams', () => {
  it('accepts valid bounds', () => {
    expect(() => validateSearchParams({ threshold: 0.5, topK: 10 })).not.toThrow()
  })

  it('rejects threshold out of range', () => {
    expect(() => validateSearchParams({ threshold: 1.1 })).toThrow(/threshold/)
  })

  it('rejects NaN threshold', () => {
    expect(() => validateSearchParams({ threshold: Number.NaN })).toThrow(/threshold/)
  })

  it('rejects negative topK', () => {
    expect(() => validateSearchParams({ topK: -1 })).toThrow(/top_k/)
  })

  it('rejects non-integer topK', () => {
    expect(() => validateSearchParams({ topK: 1.5 })).toThrow(/top_k/)
  })
})

describe('strictToolArgs', () => {
  it('returns the arguments object when every key is allowed', () => {
    expect(strictToolArgs({ a: 1 }, ['a', 'b'])).toEqual({ a: 1 })
  })

  it('treats missing arguments as an empty object', () => {
    expect(strictToolArgs(undefined, ['a'])).toEqual({})
  })

  it('rejects anything but a JSON object', () => {
    for (const args of [null, 'a', 3, ['a'], true]) {
      expect(() => strictToolArgs(args, ['a'])).toThrow('Arguments must be a JSON object')
    }
  })

  it('names the first unknown key and the allowed ones', () => {
    expect(() => strictToolArgs({ a: 1, thoughtId: 'x' }, ['a', 'b'])).toThrow(
      'Unknown argument: thoughtId. Allowed: a, b',
    )
  })

  it('says (none) when the tool takes no arguments', () => {
    expect(() => strictToolArgs({ a: 1 }, [])).toThrow('Unknown argument: a. Allowed: (none)')
  })
})

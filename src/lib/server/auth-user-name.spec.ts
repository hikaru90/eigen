import { describe, expect, it } from 'vitest'
import { composeDisplayName, normalizeUserNameFields, splitDisplayName } from './auth-user-name'

describe('splitDisplayName', () => {
  it('splits multi-word names into first and last', () => {
    expect(splitDisplayName('Ada Byron Lovelace')).toEqual({
      firstName: 'Ada',
      lastName: 'Byron Lovelace',
    })
  })

  it('returns firstName only for a single token', () => {
    expect(splitDisplayName('Madonna')).toEqual({ firstName: 'Madonna' })
  })

  it('returns empty for blank input', () => {
    expect(splitDisplayName('   ')).toEqual({})
  })
})

describe('normalizeUserNameFields', () => {
  it('derives firstName from name when OAuth omitted given_name', () => {
    expect(normalizeUserNameFields({ name: 'Ada Lovelace' })).toEqual({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
  })

  it('composes name from firstName and lastName when name is missing', () => {
    expect(normalizeUserNameFields({ firstName: 'Ada', lastName: 'Lovelace' })).toEqual({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
  })

  it('preserves explicit firstName over re-splitting name', () => {
    expect(
      normalizeUserNameFields({
        name: 'Wrong Full Name',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).toEqual({
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
  })
})

describe('composeDisplayName', () => {
  it('joins first and last with a space', () => {
    expect(composeDisplayName('Ada', 'Lovelace')).toBe('Ada Lovelace')
  })

  it('returns first name alone when last is absent', () => {
    expect(composeDisplayName('Ada')).toBe('Ada')
  })
})

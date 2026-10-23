import { describe, expect, it } from 'vitest'
import { formatAuthorDisplay } from './author-display'

/** D1: first name + last-name initial ("Noor K."); never email or user id. */
describe('formatAuthorDisplay', () => {
  it('shows first name and last-name initial', () => {
    expect(
      formatAuthorDisplay({ firstName: 'Noor', lastName: 'Khalil', name: 'Noor Khalil' }),
    ).toBe('Noor K.')
  })

  it('uses the first letter of a multi-word last name and uppercases it', () => {
    expect(formatAuthorDisplay({ firstName: 'Elio', lastName: 'van der Berg' })).toBe('Elio V.')
  })

  it('handles non-latin initials as one character', () => {
    expect(formatAuthorDisplay({ firstName: 'Ana', lastName: 'Ørsted' })).toBe('Ana Ø.')
  })

  it('shows the first name alone when there is no last name', () => {
    expect(formatAuthorDisplay({ firstName: 'Sana', lastName: null, name: 'Sana' })).toBe('Sana')
  })

  it('derives the parts from the display name when first/last are missing', () => {
    expect(
      formatAuthorDisplay({ firstName: null, lastName: null, name: 'Tomas  Ruiz Pérez' }),
    ).toBe('Tomas R.')
  })

  it('returns null when the account carries no name at all', () => {
    expect(formatAuthorDisplay({ firstName: ' ', lastName: '', name: '' })).toBeNull()
  })

  it('never leaks the email local part or a full last name', () => {
    const shown = formatAuthorDisplay({ firstName: 'Rhea', lastName: 'Montgomery', name: 'Rhea' })
    expect(shown).not.toContain('Montgomery')
    expect(shown).not.toContain('@')
  })
})

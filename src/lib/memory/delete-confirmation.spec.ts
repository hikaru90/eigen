import { describe, expect, it } from 'vitest'
import {
  DELETE_ALL_MEMORIES_CONFIRMATION,
  isDeleteAllMemoriesConfirmation,
} from './delete-confirmation'

describe('delete-confirmation', () => {
  it('accepts exact phrase after trim', () => {
    expect(isDeleteAllMemoriesConfirmation(`  ${DELETE_ALL_MEMORIES_CONFIRMATION}  `)).toBe(true)
  })

  it('rejects partial or wrong phrase', () => {
    expect(isDeleteAllMemoriesConfirmation('DELETE ALL')).toBe(false)
    expect(isDeleteAllMemoriesConfirmation('delete all my memories')).toBe(false)
  })
})

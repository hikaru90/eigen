import { describe, expect, it } from 'vitest'
import { shouldRefetchRecentForViewChange } from './recent-view-sync'

describe('shouldRefetchRecentForViewChange', () => {
  it('skips the initial subscribe echo (previous === null)', () => {
    expect(shouldRefetchRecentForViewChange(null, 'user')).toBe(false)
    expect(shouldRefetchRecentForViewChange(null, 'all')).toBe(false)
    expect(shouldRefetchRecentForViewChange(null, 'apikey:key-1')).toBe(false)
  })

  it('refetches when the view actually changes', () => {
    expect(shouldRefetchRecentForViewChange('user', 'all')).toBe(true)
    expect(shouldRefetchRecentForViewChange('all', 'user')).toBe(true)
    expect(shouldRefetchRecentForViewChange('user', 'apikey:key-1')).toBe(true)
  })

  it('does not refetch when the view is unchanged', () => {
    expect(shouldRefetchRecentForViewChange('user', 'user')).toBe(false)
    expect(shouldRefetchRecentForViewChange('all', 'all')).toBe(false)
    expect(shouldRefetchRecentForViewChange('apikey:key-1', 'apikey:key-1')).toBe(false)
  })
})

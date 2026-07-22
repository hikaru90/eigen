import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  getCurrentUserView,
  setCurrentUserView,
  subscribeCurrentUserView,
} from './current-user-view.svelte'

describe('current-user-view shared state', () => {
  beforeEach(() => {
    setCurrentUserView('user')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('get/set round-trip', () => {
    expect(getCurrentUserView()).toBe('user')
    setCurrentUserView('all')
    expect(getCurrentUserView()).toBe('all')
  })

  it('subscribe fires immediately then on change', () => {
    const listener = vi.fn()
    const unsub = subscribeCurrentUserView(listener)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith('user')

    setCurrentUserView('all')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith('all')

    setCurrentUserView('all')
    expect(listener).toHaveBeenCalledTimes(2)

    unsub()
    setCurrentUserView('user')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('persists to localStorage on set', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem, getItem: vi.fn() })
    setCurrentUserView('all')
    expect(setItem).toHaveBeenCalledWith('current-user-view', 'all')
  })
})

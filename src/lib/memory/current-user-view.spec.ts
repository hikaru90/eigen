import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers'
import {
  authorLayerKeyFromItem,
  isValidCurrentUserView,
  matchesCurrentUserView,
  resolveInitialCurrentUserView,
  viewAuthorLayerKey,
  viewKind,
  viewLabel,
  viewToMemoryAuthor,
  viewToVisibleAuthorLayers,
  CURRENT_USER_VIEW_STORAGE_KEY,
  LEGACY_TIMELINE_AUTHOR_FILTER_KEY,
} from './current-user-view'

const layers: AuthorLayerMeta[] = [
  { key: 'user', label: 'You', kind: 'user' },
  { key: 'apikey:key-1', label: 'Cursor', kind: 'agent' },
  { key: 'label:LegacyBot', label: 'LegacyBot', kind: 'agent' },
]

function createStorageMock(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
  }
}

describe('current-user-view helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('authorLayerKeyFromItem maps authorship tuples', () => {
    expect(authorLayerKeyFromItem({ author: 'user' })).toBe('user')
    expect(
      authorLayerKeyFromItem({
        author: 'agent',
        authorKeyId: 'key-1',
        authorLabel: 'Cursor',
      }),
    ).toBe('apikey:key-1')
    expect(
      authorLayerKeyFromItem({
        author: 'agent',
        authorLabel: 'LegacyBot',
      }),
    ).toBe('label:LegacyBot')
  })

  it('viewToVisibleAuthorLayers follows graph convention', () => {
    expect(viewToVisibleAuthorLayers('user')).toEqual(new Set(['user']))
    expect(viewToVisibleAuthorLayers('all').size).toBe(0)
    expect(viewToVisibleAuthorLayers('apikey:key-1')).toEqual(new Set(['apikey:key-1']))
  })

  it('viewToMemoryAuthor and viewAuthorLayerKey', () => {
    expect(viewToMemoryAuthor('user')).toBe('user')
    expect(viewToMemoryAuthor('all')).toBeUndefined()
    expect(viewToMemoryAuthor('apikey:key-1')).toBe('agent')
    expect(viewAuthorLayerKey('user')).toBeNull()
    expect(viewAuthorLayerKey('all')).toBeNull()
    expect(viewAuthorLayerKey('apikey:key-1')).toBe('apikey:key-1')
  })

  it('matchesCurrentUserView filters items', () => {
    const item = { author: 'agent' as const, authorKeyId: 'key-1', authorLabel: 'Cursor' }
    expect(matchesCurrentUserView(item, 'all')).toBe(true)
    expect(matchesCurrentUserView(item, 'user')).toBe(false)
    expect(matchesCurrentUserView(item, 'apikey:key-1')).toBe(true)
  })

  it('viewLabel resolves display names', () => {
    expect(viewLabel('user', layers)).toBe('You')
    expect(viewLabel('all', layers)).toBe('Everything')
    expect(viewLabel('apikey:key-1', layers)).toBe('Cursor')
  })

  it('viewKind returns icon kind', () => {
    expect(viewKind('user', layers)).toBe('user')
    expect(viewKind('all', layers)).toBe('user')
    expect(viewKind('apikey:key-1', layers)).toBe('agent')
  })

  it('isValidCurrentUserView checks against known layers', () => {
    expect(isValidCurrentUserView('user', layers)).toBe(true)
    expect(isValidCurrentUserView('all', layers)).toBe(true)
    expect(isValidCurrentUserView('apikey:key-1', layers)).toBe(true)
    expect(isValidCurrentUserView('apikey:missing', layers)).toBe(false)
  })

  it('resolveInitialCurrentUserView reads storage and migrates legacy timeline filter', () => {
    localStorage.setItem(CURRENT_USER_VIEW_STORAGE_KEY, 'apikey:key-1')
    expect(resolveInitialCurrentUserView(layers)).toBe('apikey:key-1')

    localStorage.removeItem(CURRENT_USER_VIEW_STORAGE_KEY)
    localStorage.setItem(LEGACY_TIMELINE_AUTHOR_FILTER_KEY, 'agent')
    expect(resolveInitialCurrentUserView(layers)).toBe('apikey:key-1')

    localStorage.setItem(LEGACY_TIMELINE_AUTHOR_FILTER_KEY, 'all')
    expect(resolveInitialCurrentUserView(layers)).toBe('all')
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/paths', () => ({ base: '/app' }))

import { thoughtHref } from './thought-href'

describe('thoughtHref — the open control of a citation leads to the thought page', () => {
  it('builds /thought/[id] under the app base', () => {
    expect(thoughtHref('0f3c9a2e')).toBe('/app/thought/0f3c9a2e')
  })

  it('escapes ids that are not path-safe', () => {
    expect(thoughtHref('a b/c')).toBe('/app/thought/a%20b%2Fc')
  })
})

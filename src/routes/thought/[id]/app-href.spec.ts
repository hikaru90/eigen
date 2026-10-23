import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/paths', () => ({ base: '/app' }))

import { echoHref, inAppHref } from './app-href'

/**
 * Every navigation off the thought page goes through a `ResolvedPathname` (the repo's
 * `svelte/no-navigation-without-resolve` lint is type-based — see
 * src/lib/chat/thought-href.ts for the same idiom).
 */
describe('inAppHref', () => {
  it('prefixes the app base and keeps query and hash', () => {
    expect(inAppHref('/mesh/yarn')).toBe('/app/mesh/yarn')
    expect(inAppHref('/chat?thought=t1#x')).toBe('/app/chat?thought=t1#x')
  })
})

describe('echoHref', () => {
  it('opens the echo as its own page and carries where the user came from', () => {
    expect(echoHref('a b', '/mesh/threads')).toBe('/app/thought/a%20b?from=%2Fmesh%2Fthreads')
  })
})

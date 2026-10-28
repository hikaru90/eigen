import { describe, expect, it } from 'vitest'
import { activeNavId } from './nav-active'

describe('activeNavId', () => {
  it('lights Capture on the capture surface', () => {
    expect(activeNavId('/capture')).toBe('capture')
    expect(activeNavId('/capture/')).toBe('capture')
  })

  it('lights Mesh on the mesh hub and its lenses', () => {
    expect(activeNavId('/mesh')).toBe('mesh')
    expect(activeNavId('/mesh/yarn')).toBe('mesh')
    expect(activeNavId('/mesh/threads')).toBe('mesh')
    expect(activeNavId('/mesh/patterns')).toBe('mesh')
  })

  it('lights Mesh on a thought up close (it is opened from the yarn)', () => {
    expect(activeNavId('/thought')).toBe('mesh')
    expect(activeNavId('/thought/abc-123')).toBe('mesh')
  })

  it('lights Ask on chat', () => {
    expect(activeNavId('/chat')).toBe('ask')
    expect(activeNavId('/chat/session/abc')).toBe('ask')
  })

  it('lights nothing on Make me better — no menu item is lit there', () => {
    expect(activeNavId('/feedback')).toBeNull()
  })

  it('lights nothing on utility and legacy surfaces', () => {
    for (const path of ['/settings', '/api-keys', '/activity', '/memory', '/desk', '/login']) {
      expect(activeNavId(path)).toBeNull()
    }
  })

  it('does not treat a longer path as a prefix match', () => {
    expect(activeNavId('/captures')).toBeNull()
    expect(activeNavId('/meshx')).toBeNull()
    expect(activeNavId('/chatx')).toBeNull()
  })
})

describe('navMarkSelector', () => {
  it('targets the bottom nav mark by tab id (the capture fly lands on the Mesh mark)', async () => {
    const { navMarkSelector } = await import('./nav-active')
    expect(navMarkSelector('mesh')).toBe('[data-nav-mark="mesh"]')
  })
})

describe('the entire graph', () => {
  it('lights Mesh on /graph (opened from Mesh)', () => {
    expect(activeNavId('/graph')).toBe('mesh')
  })
})

describe('displayedNavId', () => {
  it('lights the tab being navigated to before its page has loaded', async () => {
    const { displayedNavId } = await import('./nav-active')
    expect(displayedNavId('/capture', '/mesh/yarn')).toBe('mesh')
    expect(displayedNavId('/mesh/yarn', '/chat')).toBe('ask')
  })

  it('lights the current tab when nothing is loading', async () => {
    const { displayedNavId } = await import('./nav-active')
    expect(displayedNavId('/chat', null)).toBe('ask')
  })
})

describe('BOTTOM_NAV_HREFS', () => {
  it('points Mesh straight at the yarn, so a tap is not a redirect plus a load', async () => {
    const { BOTTOM_NAV_HREFS } = await import('./nav-active')
    expect(BOTTOM_NAV_HREFS).toEqual({ capture: '/capture', mesh: '/mesh/yarn', ask: '/chat' })
  })
})

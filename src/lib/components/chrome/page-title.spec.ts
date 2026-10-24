import { describe, expect, it } from 'vitest'
import { pageTitle } from './page-title'

const labels = {
  capture: 'Capture',
  mesh: 'Mesh',
  ask: 'Ask',
  contribute: 'Contribute',
  notifications: 'Notifications',
  summary: 'Daily summary',
}

describe('pageTitle', () => {
  it('names every core page from its route', () => {
    expect(pageTitle('/capture', null, labels)).toBe('Capture — Eigenmesh')
    expect(pageTitle('/mesh/threads/abc', null, labels)).toBe('Mesh — Eigenmesh')
    expect(pageTitle('/chat', null, labels)).toBe('Ask — Eigenmesh')
    expect(pageTitle('/feedback', null, labels)).toBe('Contribute — Eigenmesh')
    expect(pageTitle('/notifications', null, labels)).toBe('Notifications — Eigenmesh')
    expect(pageTitle('/summary', null, labels)).toBe('Daily summary — Eigenmesh')
  })

  it('a thought page is titled by its words', () => {
    expect(pageTitle('/thought/t1', 'x'.repeat(80), labels)).toBe('x'.repeat(60))
  })

  it('anything else is the app', () => {
    expect(pageTitle('/settings', null, labels)).toBe('Eigenmesh')
  })
})

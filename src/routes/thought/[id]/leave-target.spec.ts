import { describe, expect, it } from 'vitest'
import { DEFAULT_LEAVE_TARGET, leaveTarget } from './leave-target'

/**
 * Where ✕ / esc / swipe-down lead. `document.referrer` is unreliable, so list rows
 * hand the page a `from` query param; anything that is not an in-app path falls back
 * to the Yarn (the thought's home on the mesh).
 */
describe('leaveTarget', () => {
  it('defaults to the yarn', () => {
    expect(DEFAULT_LEAVE_TARGET).toBe('/mesh/yarn')
    expect(leaveTarget(null)).toBe('/mesh/yarn')
    expect(leaveTarget('')).toBe('/mesh/yarn')
    expect(leaveTarget('   ')).toBe('/mesh/yarn')
  })

  it('keeps an in-app path, with its query', () => {
    expect(leaveTarget('/mesh/threads')).toBe('/mesh/threads')
    expect(leaveTarget('/chat?session=abc')).toBe('/chat?session=abc')
    expect(leaveTarget('/mesh/patterns#p1')).toBe('/mesh/patterns#p1')
  })

  it('refuses anything that could leave the app', () => {
    expect(leaveTarget('https://example.com/x')).toBe('/mesh/yarn')
    expect(leaveTarget('//example.com/x')).toBe('/mesh/yarn')
    expect(leaveTarget('javascript:alert(1)')).toBe('/mesh/yarn')
    expect(leaveTarget('mesh/yarn')).toBe('/mesh/yarn')
    expect(leaveTarget('/\\example.com')).toBe('/mesh/yarn')
  })
})

import { describe, expect, it } from 'vitest'
import { compress } from './compress'

describe('embedding-compress (vendored cavemem-style)', () => {
  it('preserves https URL text', () => {
    const s = 'see https://example.com/path?q=1 for docs'
    const out = compress(s, { intensity: 'full' })
    expect(out).toContain('https://example.com/path?q=1')
  })

  it('accepts lite and ultra intensities', () => {
    const s = 'I think that basically it is very good.'
    const lite = compress(s, { intensity: 'lite' })
    const ultra = compress(s, { intensity: 'ultra' })
    expect(ultra.length).toBeLessThanOrEqual(lite.length)
  })

  it('defaults to full intensity when options are omitted', () => {
    const s = 'I think that basically it is very good.'
    expect(compress(s)).toBe(compress(s, { intensity: 'full' }))
  })

  it('preserves source casing when abbreviating', () => {
    expect(compress('Update the CONFIGURATION file.', { intensity: 'full' })).toContain('CONFIG')
    expect(compress('Update the Configuration file.', { intensity: 'full' })).toContain('Config')
  })

  it('preserves leading and trailing whitespace padding semantics', () => {
    expect(compress('\n  hello world  \n', { intensity: 'full' })).toMatch(/^\n/)
    expect(compress('  hello world  ', { intensity: 'full' })).toMatch(/^ /)
    expect(compress('   ', { intensity: 'full' })).toBe('   ')
  })
})

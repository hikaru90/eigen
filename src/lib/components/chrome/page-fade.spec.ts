import { describe, expect, it } from 'vitest'
import { pageFadeVars } from './page-fade'

describe('pageFadeVars', () => {
  it.each(['feedback', 'ask', 'capture'] as const)(
    '%s fades up past the docked writer at its live height (reading row and cards included)',
    (view) => {
      expect(pageFadeVars(view)).toContain('var(--glass-writer-height,64px)')
    },
  )

  it('pages without a writer fade only above the bottom menu', () => {
    expect(pageFadeVars('mesh')).not.toContain('--glass-writer-height')
    expect(pageFadeVars(null)).not.toContain('--glass-writer-height')
  })
})

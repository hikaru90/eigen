import { describe, expect, it } from 'vitest'
import { DEFAULT_WEBSITE_ORIGIN, websiteLegalUrl, WEBSITE_LEGAL_PATHS } from './website-legal-urls'

describe('websiteLegalUrl', () => {
  it('uses the default marketing origin when none is provided', () => {
    expect(websiteLegalUrl('terms')).toBe(`${DEFAULT_WEBSITE_ORIGIN}/terms`)
    expect(websiteLegalUrl('privacy')).toBe(`${DEFAULT_WEBSITE_ORIGIN}/privacy`)
    expect(websiteLegalUrl('imprint')).toBe(`${DEFAULT_WEBSITE_ORIGIN}/imprint`)
  })

  it('prefers an explicit PUBLIC_WEBSITE_ORIGIN (no trailing slash)', () => {
    expect(websiteLegalUrl('terms', 'https://preview.eigenmesh.xyz/')).toBe(
      'https://preview.eigenmesh.xyz/terms',
    )
  })

  it('exposes stable path keys for the marketing site', () => {
    expect(WEBSITE_LEGAL_PATHS).toEqual({
      terms: '/terms',
      privacy: '/privacy',
      imprint: '/imprint',
    })
  })
})

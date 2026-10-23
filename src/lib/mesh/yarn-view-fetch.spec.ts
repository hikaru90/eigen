import { describe, expect, it } from 'vitest'
import { yarnApiUrlForView } from './yarn-view-fetch'

describe('yarnApiUrlForView', () => {
  it('maps the You view to the coarse user author filter', () => {
    expect(yarnApiUrlForView('user')).toBe('/api/mesh/yarn?author=user')
  })

  it('maps All Users to the tenant-wide author scope', () => {
    expect(yarnApiUrlForView('all')).toBe('/api/mesh/yarn?author=all')
  })

  it('maps an agent layer to its authorLayerKey (same format as /api/timeline)', () => {
    expect(yarnApiUrlForView('apikey:abc-123')).toBe('/api/mesh/yarn?authorLayerKey=apikey%3Aabc-123')
  })
})

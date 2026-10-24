import { describe, expect, it } from 'vitest'
import { meshApiUrlForView } from './mesh-view-fetch'

describe('meshApiUrlForView', () => {
  it.each(['yarn', 'threads'] as const)('maps the You view to author=user on %s', (tab) => {
    expect(meshApiUrlForView(tab, 'user')).toBe(`/api/mesh/${tab}?author=user`)
  })

  it.each(['yarn', 'threads'] as const)('maps the all view to author=all on %s', (tab) => {
    expect(meshApiUrlForView(tab, 'all')).toBe(`/api/mesh/${tab}?author=all`)
  })

  it.each(['yarn', 'threads'] as const)('maps an agent layer to authorLayerKey on %s', (tab) => {
    expect(meshApiUrlForView(tab, 'apikey:abc-123')).toBe(
      `/api/mesh/${tab}?authorLayerKey=apikey%3Aabc-123`,
    )
  })
})

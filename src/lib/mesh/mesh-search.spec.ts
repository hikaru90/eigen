import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeMeshSearch,
  meshSearch,
  openMeshSearch,
  setMeshSearchQuery,
} from './mesh-search.svelte'

/**
 * Shared state for the Mesh tab row's search (DESIGN.md "Search": a round
 * button at the end of the tab row that opens into a field filtering the list
 * in place). The layout owns the field and writes through the actions below;
 * the pages read `meshSearch.query` in $derived to filter. ei keeps the field's
 * value while you switch tabs — so closing is the only thing that clears it.
 */

describe('mesh-search store', () => {
  beforeEach(() => {
    closeMeshSearch()
  })

  it('starts closed and empty', () => {
    expect(meshSearch.open).toBe(false)
    expect(meshSearch.query).toBe('')
  })

  it('opens the in-track field without touching the query', () => {
    setMeshSearchQuery('atlas')
    openMeshSearch()
    expect(meshSearch.open).toBe(true)
    expect(meshSearch.query).toBe('atlas')
  })

  it('records what was typed as the query', () => {
    openMeshSearch()
    setMeshSearchQuery('garden')
    expect(meshSearch.query).toBe('garden')
    setMeshSearchQuery('')
    expect(meshSearch.query).toBe('')
  })

  it('closing clears the query (✕ / esc)', () => {
    openMeshSearch()
    setMeshSearchQuery('garden')
    closeMeshSearch()
    expect(meshSearch.open).toBe(false)
    expect(meshSearch.query).toBe('')
  })
})

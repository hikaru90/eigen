/**
 * Shared state for the Mesh tab row's search (DESIGN.md "Search"): a round
 * button at the end of the tab row that opens into a field filtering the list
 * in place; ✕ or esc closes and clears it. The Mesh layout owns the field and
 * writes through the actions below (event boundaries); the pages read
 * `meshSearch.query` in `$derived` to filter their rows. Like ei, the value
 * survives switching tabs — only closing clears it.
 */

export const meshSearch = $state({
  open: false,
  query: '',
})

export function openMeshSearch(): void {
  meshSearch.open = true
}

/** Close the field and clear it, so nothing filters unseen. */
export function closeMeshSearch(): void {
  meshSearch.open = false
  meshSearch.query = ''
}

export function setMeshSearchQuery(query: string): void {
  meshSearch.query = query
}

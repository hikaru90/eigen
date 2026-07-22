import { SvelteSet } from 'svelte/reactivity'
import { COMMUNITY_LEAF_LEVEL } from '$lib/graph/community-levels'

/** Graph filter state; survives client-side route changes and tab switches. */
export const graphFilters = $state({
  search: '',
  edgeKind: 'all',
  communityLevel: String(COMMUNITY_LEAF_LEVEL),
  visibleEntityTypes: new SvelteSet<string>(),
  visibleAuthorLayers: new SvelteSet<string>(),
})

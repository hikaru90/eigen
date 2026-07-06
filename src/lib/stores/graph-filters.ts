import { writable } from 'svelte/store';
import { COMMUNITY_LEAF_LEVEL } from '$lib/graph/community-levels';

/** Graph filter state; survives client-side route changes and tab switches. */
export const graphFilters = writable({
  search: '',
  edgeKind: 'all',
  communityLevel: String(COMMUNITY_LEAF_LEVEL),
  visibleEntityTypes: new Set<string>(),
  visibleAuthorLayers: new Set<string>()
});

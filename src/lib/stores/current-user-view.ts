import { writable } from 'svelte/store';
import type { AuthorLayerMeta } from '$lib/graph/graph-author-layers';
import {
	CURRENT_USER_VIEW_STORAGE_KEY,
	resolveInitialCurrentUserView,
	type CurrentUserView
} from '$lib/memory/current-user-view';

export type { CurrentUserView };

/** Global data-view filter; survives client-side route changes. */
export const currentUserView = writable<CurrentUserView>('user');

let initialized = false;

/** Call once from layout when authorLayers are available. */
export function initCurrentUserViewStore(authorLayers: readonly AuthorLayerMeta[]): void {
	if (initialized || typeof localStorage === 'undefined') return;
	initialized = true;
	currentUserView.set(resolveInitialCurrentUserView(authorLayers));
	currentUserView.subscribe((view) => {
		localStorage.setItem(CURRENT_USER_VIEW_STORAGE_KEY, view);
	});
}

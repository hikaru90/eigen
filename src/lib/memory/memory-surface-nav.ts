export type MemorySurfaceTab = 'graph' | 'embeddings' | 'timeline' | 'notes';

/** Which Memory hub secondary tab is active from pathname and optional ?view= param. */
export function activeMemorySurfaceTab(pathname: string, viewParam: string | null): MemorySurfaceTab {
	if (pathname.includes('/memory/timeline')) return 'timeline';
	if (pathname.includes('/memory/notes')) return 'notes';
	if (pathname.includes('/memory')) {
		return viewParam === 'embeddings' ? 'embeddings' : 'graph';
	}
	return 'graph';
}

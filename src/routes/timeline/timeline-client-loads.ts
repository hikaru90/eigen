import type { CurrentUserView } from '$lib/memory/current-user-view';

/**
 * Prod fetch budget for a cold `/memory/timeline` mount.
 * DevTools regressions that exceed this are user-visible waste.
 */
export const TIMELINE_MOUNT_FETCH_BUDGET = {
	/** `GET /api/temporal-events?range=relevant&status=all…` — main list once */
	temporalEventsRelevant: 1,
	/** `GET /api/temporal-events?range=all&status=open…` — overdue pool once */
	temporalEventsOverdueOpen: 1,
	/** `GET /api/timeline/stats` — segment tab counts once */
	timelineStats: 1
} as const;

/**
 * Store subscribe fires immediately with the current value. Mount already loads
 * lists in `onMount`, so the initial subscribe must not refetch.
 */
export function shouldRefetchForViewChange(
	previous: CurrentUserView | null,
	next: CurrentUserView
): boolean {
	if (previous === null) return false;
	return previous !== next;
}

/**
 * Stats must load on first paint and only again when the parent explicitly
 * bumps a refresh key — not when tab counts / segment props churn.
 */
export function shouldFetchTimelineStats(
	previousKey: number | null,
	nextKey: number
): boolean {
	if (previousKey === null) return true;
	return previousKey !== nextKey;
}

/** Classify temporal-events list URLs for fetch-budget assertions. */
export function classifyTemporalEventsFetch(url: string): 'relevant' | 'overdue-open' | 'other' {
	let parsed: URL;
	try {
		parsed = new URL(url, 'http://local.test');
	} catch {
		return 'other';
	}
	if (!parsed.pathname.endsWith('/api/temporal-events')) return 'other';
	const range = parsed.searchParams.get('range');
	const status = parsed.searchParams.get('status');
	if (range === 'relevant' && status === 'all') return 'relevant';
	if (range === 'all' && status === 'open') return 'overdue-open';
	return 'other';
}

export function isTimelineStatsFetch(url: string): boolean {
	try {
		return new URL(url, 'http://local.test').pathname.endsWith('/api/timeline/stats');
	} catch {
		return false;
	}
}

/**
 * Count classified fetches against the mount budget. Returns over-budget keys.
 */
export function findMountFetchBudgetViolations(urls: readonly string[]): string[] {
	let relevant = 0;
	let overdueOpen = 0;
	let stats = 0;
	for (const url of urls) {
		if (isTimelineStatsFetch(url)) {
			stats += 1;
			continue;
		}
		const kind = classifyTemporalEventsFetch(url);
		if (kind === 'relevant') relevant += 1;
		else if (kind === 'overdue-open') overdueOpen += 1;
	}
	const violations: string[] = [];
	if (relevant > TIMELINE_MOUNT_FETCH_BUDGET.temporalEventsRelevant) {
		violations.push(
			`temporal-events relevant: ${relevant} > ${TIMELINE_MOUNT_FETCH_BUDGET.temporalEventsRelevant}`
		);
	}
	if (overdueOpen > TIMELINE_MOUNT_FETCH_BUDGET.temporalEventsOverdueOpen) {
		violations.push(
			`temporal-events overdue-open: ${overdueOpen} > ${TIMELINE_MOUNT_FETCH_BUDGET.temporalEventsOverdueOpen}`
		);
	}
	if (stats > TIMELINE_MOUNT_FETCH_BUDGET.timelineStats) {
		violations.push(`timeline/stats: ${stats} > ${TIMELINE_MOUNT_FETCH_BUDGET.timelineStats}`);
	}
	return violations;
}

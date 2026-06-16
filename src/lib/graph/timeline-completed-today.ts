import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list';
import { isTimelineItemCompleted } from '$lib/graph/timeline-overdue';

function localDayKey(iso: string, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(iso));
}

/** Best-effort instant when the item was marked complete (for "done today" grouping). */
export function completionInstantIso(item: TemporalEventListItem): string | null {
	if (!isTimelineItemCompleted(item)) return null;
	if (item.completedAt) return item.completedAt;
	if (item.lifecycleUpdatedAt) return item.lifecycleUpdatedAt;
	return null;
}

export function isCompletedToday(
	item: TemporalEventListItem,
	timeZone: string,
	now = new Date()
): boolean {
	const instant = completionInstantIso(item);
	if (!instant) return false;
	return localDayKey(instant, timeZone) === localDayKey(now.toISOString(), timeZone);
}

export function filterCompletedTodayItems(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): TemporalEventListItem[] {
	return items.filter((item) => isCompletedToday(item, timeZone, now));
}

export function completedTodayCount(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): number {
	return filterCompletedTodayItems(items, timeZone, now).length;
}

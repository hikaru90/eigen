import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list';

const DEFAULT_EVENT_DURATION_MIN = 60;

export function isTimelineItemCompleted(item: TemporalEventListItem): boolean {
	if (item.lifecycleStatus === 'completed') return true;
	if (item.lifecycleStatus === 'cancelled' || item.lifecycleStatus === 'dismissed') return true;
	return item.thoughtStatus === 'completed';
}

export function overdueDebtMinutes(items: TemporalEventListItem[], now = new Date()): number {
	return items
		.filter(
			(i) =>
				i.itemType === 'event' &&
				!isTimelineItemCompleted(i) &&
				i.endAt &&
				new Date(i.endAt).getTime() < now.getTime()
		)
		.reduce((sum, i) => sum + (i.durationMinutes ?? DEFAULT_EVENT_DURATION_MIN), 0);
}

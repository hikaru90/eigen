import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list';

const DEFAULT_EVENT_DURATION_MIN = 60;

function localDayKeyFromIso(iso: string, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(iso));
}

export function itemStartDayKey(
	item: TemporalEventListItem,
	timeZone: string
): string | null {
	if (!item.startAt) return null;
	return localDayKeyFromIso(item.startAt, item.timezone?.trim() || timeZone);
}

/** Calendar day of start matches today, or no scheduled time (open loop). */
export function isScheduledForToday(
	item: TemporalEventListItem,
	timeZone: string,
	now = new Date()
): boolean {
	if (!item.startAt) return true;
	const todayKey = localDayKeyFromIso(now.toISOString(), timeZone);
	return itemStartDayKey(item, timeZone) === todayKey;
}

export function isTimelineItemCompleted(item: TemporalEventListItem): boolean {
	if (item.lifecycleStatus === 'completed') return true;
	if (item.lifecycleStatus === 'cancelled' || item.lifecycleStatus === 'dismissed') return true;
	return item.thoughtStatus === 'completed';
}

export function isOverdueItem(item: TemporalEventListItem, now = new Date()): boolean {
	if (isTimelineItemCompleted(item)) return false;
	const nowMs = now.getTime();
	if (item.endAt && new Date(item.endAt).getTime() < nowMs) return true;
	if (item.startAt && new Date(item.startAt).getTime() < nowMs) return true;
	return false;
}

/** Overdue and scheduled before today — not still part of today's task list. */
export function isPriorDayOverdue(
	item: TemporalEventListItem,
	timeZone: string,
	now = new Date()
): boolean {
	if (!isOverdueItem(item, now)) return false;
	return !isScheduledForToday(item, timeZone, now);
}

export function filterOverdueItems(
	items: TemporalEventListItem[],
	now = new Date()
): TemporalEventListItem[] {
	return items.filter((item) => isOverdueItem(item, now));
}

export function filterPriorDayOverdueItems(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): TemporalEventListItem[] {
	return items.filter((item) => isPriorDayOverdue(item, timeZone, now));
}

export function overdueCount(items: TemporalEventListItem[], now = new Date()): number {
	return filterOverdueItems(items, now).length;
}

export function priorDayOverdueCount(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): number {
	return filterPriorDayOverdueItems(items, timeZone, now).length;
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

/** Milliseconds past the due instant (endAt, else startAt). */
export function overdueElapsedMs(
	item: TemporalEventListItem,
	now = new Date()
): number | null {
	if (!isOverdueItem(item, now)) return null;
	const dueAt = item.endAt ?? item.startAt;
	if (!dueAt) return null;
	const elapsed = now.getTime() - new Date(dueAt).getTime();
	return elapsed > 0 ? elapsed : null;
}

export type OverdueElapsedBucket =
	| { unit: 'minutes'; value: number }
	| { unit: 'hours'; value: number }
	| { unit: 'days'; value: number };

export function bucketOverdueElapsed(ms: number): OverdueElapsedBucket {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return { unit: 'minutes', value: Math.max(1, minutes) };
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return { unit: 'hours', value: hours };
	return { unit: 'days', value: Math.floor(hours / 24) };
}

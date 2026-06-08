import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list';

/** Deterministic focus rank: lower = higher priority. */
export function computeFocusRank(
	item: TemporalEventListItem,
	now: Date,
	timeZone: string
): number {
	if (item.itemType === 'open_loop') return 600;

	const section = agendaSectionScore(item, now, timeZone);
	let rank = section;

	if (item.kind === 'deadline') rank -= 50;
	if (item.kind === 'appointment') rank -= 30;
	if (item.focusRank != null) rank = Math.min(rank, item.focusRank);

	const endMs = item.endAt ? new Date(item.endAt).getTime() : null;
	if (endMs != null && endMs < now.getTime()) rank -= 200;

	return rank;
}

function localDayKey(iso: string, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(iso));
}

function agendaSectionScore(item: TemporalEventListItem, now: Date, timeZone: string): number {
	if (!item.startAt) return 900;
	const todayKey = localDayKey(now.toISOString(), timeZone);
	const startKey = localDayKey(item.startAt, timeZone);
	if (startKey === todayKey) return 100;
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	if (startKey === localDayKey(tomorrow.toISOString(), timeZone)) return 300;
	const startMs = new Date(item.startAt).getTime();
	const weekEnd = now.getTime() + 7 * 24 * 60 * 60 * 1000;
	if (startMs < weekEnd) return 500;
	return 800;
}

export function sortByFocusRank(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): TemporalEventListItem[] {
	return [...items].sort(
		(a, b) => computeFocusRank(a, now, timeZone) - computeFocusRank(b, now, timeZone)
	);
}

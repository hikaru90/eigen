import {
	CalendarDate,
	fromDate,
	getLocalTimeZone,
	parseAbsolute,
	toCalendarDate
} from '@internationalized/date';
import type { TemporalEventListItem } from '../api/temporal-events/+server';

export const KIND_LABELS: Record<string, string> = {
	deadline: 'Deadline',
	appointment: 'Appointment',
	milestone: 'Milestone',
	period: 'Period',
	reminder: 'Reminder',
	inferred_event: 'Event'
};

export const KIND_COLORS: Record<string, string> = {
	deadline: '#dc2626',
	appointment: '#2563eb',
	milestone: '#7c3aed',
	period: '#059669',
	reminder: '#d97706',
	inferred_event: '#64748b'
};

export const KANBAN_KIND_ORDER = [
	'deadline',
	'appointment',
	'milestone',
	'period',
	'reminder',
	'inferred_event'
] as const;

export function kindLabel(kind: string): string {
	return KIND_LABELS[kind] ?? kind;
}

export function kindColor(kind: string): string {
	return KIND_COLORS[kind] ?? '#64748b';
}

function formatCalendarDateKey(cd: CalendarDate): string {
	return `${cd.year}-${String(cd.month).padStart(2, '0')}-${String(cd.day).padStart(2, '0')}`;
}

/** Calendar date YYYY-MM-DD for an ISO instant in the given IANA timezone. */
export function calendarDateKey(iso: string, timeZone: string): string {
	const zdt = parseAbsolute(iso, timeZone);
	return formatCalendarDateKey(toCalendarDate(zdt));
}

/** Local calendar day key YYYY-MM-DD for a calendar grid cell. */
export function dayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function localViewDayKey(day: Date): string {
	return dayKey(day);
}

function eventTimeZone(item: TemporalEventListItem): string {
	const tz = item.timezone?.trim();
	return tz || 'UTC';
}

function isDateOnlyEvent(item: TemporalEventListItem): boolean {
	return item.isAllDay || item.timePrecision === 'day';
}

/** Inclusive/exclusive calendar-date bounds in the event timezone (half-open [start, end)). */
export function eventDateKeys(item: TemporalEventListItem): { startKey: string; endKey: string } | null {
	if (!item.startAt) return null;
	const tz = eventTimeZone(item);
	const startKey = calendarDateKey(item.startAt, tz);
	if (!item.endAt) {
		const next = toCalendarDate(parseAbsolute(item.startAt, tz)).add({ days: 1 });
		return { startKey, endKey: formatCalendarDateKey(next) };
	}
	const endKey = calendarDateKey(item.endAt, tz);
	return { startKey, endKey };
}

/** Browser-local [startMs, endMs) for a grid day, DST-safe. */
export function localViewDayBoundsMs(day: Date): { start: number; end: number } {
	const tz = getLocalTimeZone();
	const cd = fromDate(day, tz);
	const start = cd.toDate(tz).getTime();
	const end = cd.add({ days: 1 }).toDate(tz).getTime();
	return { start, end };
}

export function formatWhen(item: TemporalEventListItem): string {
	if (!item.startAt) return '—';
	const tz = eventTimeZone(item);
	const start = new Date(item.startAt);
	const end = item.endAt ? new Date(item.endAt) : null;

	if (isDateOnlyEvent(item)) {
		const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: tz });
		const keys = eventDateKeys(item);
		if (keys && item.endAt) {
			const lastDay = toCalendarDate(parseAbsolute(item.endAt, tz)).subtract({ days: 1 });
			const lastKey = formatCalendarDateKey(lastDay);
			if (lastKey !== keys.startKey) {
				return `${fmt.format(start)} – ${fmt.format(toCalendarDate(lastDay).toDate(tz))}`;
			}
		}
		return fmt.format(start);
	}

	const fmt = new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: tz
	});
	if (end && end.getTime() - start.getTime() > 36 * 60 * 60 * 1000) {
		return `${fmt.format(start)} – ${fmt.format(end)}`;
	}
	return fmt.format(start);
}

export function filterItemsByRange(
	items: TemporalEventListItem[],
	rangeFilter: 'all' | 'upcoming' | 'past'
): TemporalEventListItem[] {
	const now = Date.now();
	return items.filter((item) => {
		if (rangeFilter === 'all') return true;
		const start = item.startAt ? new Date(item.startAt).getTime() : 0;
		const end = item.endAt ? new Date(item.endAt).getTime() : start;
		if (rangeFilter === 'upcoming') return end >= now;
		return start < now;
	});
}

export function eventRangeMs(item: TemporalEventListItem): { start: number; end: number } | null {
	if (!item.startAt) return null;
	const start = new Date(item.startAt).getTime();
	const end = item.endAt ? new Date(item.endAt).getTime() : start + 60 * 60 * 1000;
	return { start, end: Math.max(end, start + 1) };
}

function eventOnDateOnlyDay(item: TemporalEventListItem, viewKey: string): boolean {
	const keys = eventDateKeys(item);
	if (!keys) return false;
	return viewKey >= keys.startKey && viewKey < keys.endKey;
}

function eventOnTimedDay(item: TemporalEventListItem, dayStart: number, dayEnd: number): boolean {
	const range = eventRangeMs(item);
	if (!range) return false;
	return range.start < dayEnd && range.end > dayStart;
}

/** Events whose active range overlaps a local calendar day. */
export function eventsOnDay(items: TemporalEventListItem[], day: Date): TemporalEventListItem[] {
	const viewKey = localViewDayKey(day);
	const { start: dayStart, end: dayEnd } = localViewDayBoundsMs(day);
	return items.filter((item) => {
		if (isDateOnlyEvent(item)) {
			return eventOnDateOnlyDay(item, viewKey);
		}
		return eventOnTimedDay(item, dayStart, dayEnd);
	});
}

export function groupByKind(items: TemporalEventListItem[]): Map<string, TemporalEventListItem[]> {
	const map = new Map<string, TemporalEventListItem[]>();
	for (const kind of KANBAN_KIND_ORDER) {
		map.set(kind, []);
	}
	for (const item of items) {
		const list = map.get(item.kind) ?? [];
		list.push(item);
		map.set(item.kind, list);
	}
	for (const [, list] of map) {
		list.sort((a, b) => {
			const as = a.startAt ? new Date(a.startAt).getTime() : 0;
			const bs = b.startAt ? new Date(b.startAt).getTime() : 0;
			return as - bs;
		});
	}
	return map;
}

export function buildMonthGrid(month: Date): Date[] {
	const year = month.getFullYear();
	const m = month.getMonth();
	const first = new Date(year, m, 1);
	const startPad = (first.getDay() + 6) % 7; // Monday-first
	const start = new Date(year, m, 1 - startPad);
	const cells: Date[] = [];
	for (let i = 0; i < 42; i++) {
		const d = new Date(start);
		d.setDate(start.getDate() + i);
		cells.push(d);
	}
	return cells;
}

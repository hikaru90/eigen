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

export type TemporalStatusFilter = 'open' | 'all';
export type TemporalRangeFilter = 'relevant' | 'upcoming' | 'past' | 'all';

export const AGENDA_SECTION_ORDER = [
	'today',
	'tomorrow',
	'this_week',
	'later',
	'past',
	'unscheduled'
] as const;

export type AgendaSection = (typeof AGENDA_SECTION_ORDER)[number];

export const AGENDA_SECTION_LABELS: Record<AgendaSection, string> = {
	today: 'Today',
	tomorrow: 'Tomorrow',
	this_week: 'This week',
	later: 'Later',
	past: 'Past',
	unscheduled: 'No date'
};

export function isTemporalEventCompleted(item: TemporalEventListItem): boolean {
	if (item.lifecycleStatus === 'completed') return true;
	if (item.lifecycleStatus === 'cancelled' || item.lifecycleStatus === 'dismissed') return true;
	return item.thoughtStatus === 'completed';
}

export function isTemporalEventOpen(item: TemporalEventListItem): boolean {
	return item.lifecycleStatus === 'open';
}

export function filterItemsByStatus(
	items: TemporalEventListItem[],
	statusFilter: TemporalStatusFilter
): TemporalEventListItem[] {
	if (statusFilter === 'all') return items;
	return items.filter((item) => isTemporalEventOpen(item));
}

export function completedEventSummaryClass(completed: boolean): string {
	return completed ? 'opacity-60 line-through' : '';
}

const RELEVANT_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

export function filterItemsByRange(
	items: TemporalEventListItem[],
	rangeFilter: TemporalRangeFilter
): TemporalEventListItem[] {
	const now = Date.now();
	return items.filter((item) => {
		if (rangeFilter === 'all') return true;
		const start = item.startAt ? new Date(item.startAt).getTime() : 0;
		const end = item.endAt ? new Date(item.endAt).getTime() : start;
		if (rangeFilter === 'upcoming') return end >= now;
		if (rangeFilter === 'past') return start < now;
		// relevant: still active (end >= now) OR starts within the next 7 days
		return end >= now || (start >= now && start <= now + RELEVANT_LOOKAHEAD_MS);
	});
}

export function filterItemsByKinds(
	items: TemporalEventListItem[],
	kinds: string[]
): TemporalEventListItem[] {
	if (kinds.length === 0) return items;
	const set = new Set(kinds);
	return items.filter((item) => set.has(item.kind));
}

function startOfLocalDayMs(day: Date, timeZone: string): number {
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const key = fmt.format(day);
	const [y, m, d] = key.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

function localDayKeyFromIso(iso: string, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(iso));
}

export function agendaSectionForItem(
	item: TemporalEventListItem,
	now: Date,
	timeZone: string
): AgendaSection {
	if (!item.startAt) return 'unscheduled';
	const nowMs = now.getTime();
	const startMs = new Date(item.startAt).getTime();
	const endMs = item.endAt ? new Date(item.endAt).getTime() : startMs;

	if (endMs < nowMs) return 'past';

	const todayKey = localDayKeyFromIso(now.toISOString(), timeZone);
	const startKey = localDayKeyFromIso(item.startAt, timeZone);
	if (startKey === todayKey) return 'today';

	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	const tomorrowKey = localDayKeyFromIso(tomorrow.toISOString(), timeZone);
	if (startKey === tomorrowKey) return 'tomorrow';

	const weekEnd = startOfLocalDayMs(now, timeZone) + 7 * 24 * 60 * 60 * 1000;
	if (startMs < weekEnd) return 'this_week';

	return 'later';
}

export function groupByAgendaSection(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): Map<AgendaSection, TemporalEventListItem[]> {
	const map = new Map<AgendaSection, TemporalEventListItem[]>();
	for (const section of AGENDA_SECTION_ORDER) {
		map.set(section, []);
	}
	for (const item of items) {
		const section = agendaSectionForItem(item, now, timeZone);
		map.get(section)!.push(item);
	}
	for (const [, list] of map) {
		list.sort((a, b) => {
			const as = a.startAt ? new Date(a.startAt).getTime() : Number.MAX_SAFE_INTEGER;
			const bs = b.startAt ? new Date(b.startAt).getTime() : Number.MAX_SAFE_INTEGER;
			return as - bs;
		});
	}
	return map;
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

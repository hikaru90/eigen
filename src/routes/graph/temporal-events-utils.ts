import {
	CalendarDate,
	fromDate,
	getLocalTimeZone,
	parseAbsolute,
	toCalendarDate
} from '@internationalized/date';
import { graphIntlLocale } from '$lib/graph/graph-i18n';
import { expandRruleOccurrences } from '$lib/graph/temporal-rrule';
type TemporalPriorityQuadrant =
	| 'urgent_important'
	| 'not_urgent_important'
	| 'urgent_not_important'
	| 'neither';
import type { TemporalEventListItem } from '../api/temporal-events/+server';
export const OPEN_LOOP_ITEM_PREFIX = 'open-loop:';

export function isOpenLoopListItem(item: TemporalEventListItem): boolean {
	return item.itemType === 'open_loop' || item.id.startsWith(OPEN_LOOP_ITEM_PREFIX);
}

export function isOpenLoopItemId(itemId: string): boolean {
	return itemId.startsWith(OPEN_LOOP_ITEM_PREFIX);
}

export function thoughtIdFromOpenLoopItemId(itemId: string): string | null {
	if (!itemId.startsWith(OPEN_LOOP_ITEM_PREFIX)) return null;
	return itemId.slice(OPEN_LOOP_ITEM_PREFIX.length);
}

export type TimelineLayoutView = 'today' | 'week' | 'agenda' | 'matrix';

export const FOCUS_MAX = 5;
export const TODAY_FOCUS_MAX = 3;

export type MatrixQuadrant = TemporalPriorityQuadrant | 'unclassified';

export const MATRIX_QUADRANT_ORDER: MatrixQuadrant[] = [
	'urgent_important',
	'not_urgent_important',
	'urgent_not_important',
	'neither',
	'unclassified'
];

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
		const fmt = new Intl.DateTimeFormat(graphIntlLocale(), { dateStyle: 'medium', timeZone: tz });
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

	const fmt = new Intl.DateTimeFormat(graphIntlLocale(), {
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

export function isSnoozed(item: TemporalEventListItem, now = new Date()): boolean {
	if (!item.snoozedUntil) return false;
	return new Date(item.snoozedUntil).getTime() > now.getTime();
}

export function filterActiveItems(
	items: TemporalEventListItem[],
	now = new Date()
): TemporalEventListItem[] {
	return items.filter((item) => !isSnoozed(item, now));
}

export function filterSnoozedItems(
	items: TemporalEventListItem[],
	now = new Date()
): TemporalEventListItem[] {
	return items.filter((item) => isSnoozed(item, now));
}

export function focusScore(item: TemporalEventListItem, now: Date, timeZone: string): number {
	if (isOpenLoopListItem(item)) return 600;
	const section = agendaSectionForItem(item, now, timeZone);
	const sectionScore: Record<AgendaSection, number> = {
		today: 100,
		tomorrow: 300,
		this_week: 500,
		later: 800,
		past: 1000,
		unscheduled: 900
	};
	let score = sectionScore[section];
	if (item.kind === 'deadline') score -= 50;
	if (item.kind === 'appointment') score -= 30;
	if (item.focusRank != null) score = Math.min(score, item.focusRank);
	const endMs = item.endAt ? new Date(item.endAt).getTime() : null;
	if (endMs != null && endMs < now.getTime()) score -= 200;
	return score;
}

export function selectFocusItems(
	items: TemporalEventListItem[],
	timeZone: string,
	max = FOCUS_MAX,
	now = new Date()
): TemporalEventListItem[] {
	const active = filterActiveItems(
		items.filter((i) => !isTemporalEventCompleted(i)),
		now
	);
	return [...active]
		.sort((a, b) => focusScore(a, now, timeZone) - focusScore(b, now, timeZone))
		.slice(0, max);
}

export function splitTodayFocusAndLater(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): { focus: TemporalEventListItem[]; later: TemporalEventListItem[] } {
	const viewItems = filterItemsForTodayView(items, timeZone, now);
	const openItems = viewItems.filter((item) => !isTemporalEventCompleted(item));
	const focus = selectFocusItems(openItems, timeZone, TODAY_FOCUS_MAX, now);
	const focusIds = new Set(focus.map((item) => item.id));
	const later = openItems.filter((item) => !focusIds.has(item.id));
	return { focus, later };
}

export function groupByMatrixQuadrant(
	items: TemporalEventListItem[]
): Map<MatrixQuadrant, TemporalEventListItem[]> {
	const map = new Map<MatrixQuadrant, TemporalEventListItem[]>();
	for (const q of MATRIX_QUADRANT_ORDER) {
		map.set(q, []);
	}
	for (const item of items) {
		const q: MatrixQuadrant = item.priorityQuadrant ?? 'unclassified';
		const list = map.get(q) ?? map.get('unclassified')!;
		list.push(item);
		map.set(q, list);
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

export function weekStartMonday(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

export function buildWeekDays(weekStart: Date): Date[] {
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(weekStart);
		d.setDate(weekStart.getDate() + i);
		return d;
	});
}

export function eventsInWeek(
	items: TemporalEventListItem[],
	weekStart: Date
): TemporalEventListItem[] {
	const weekEnd = new Date(weekStart);
	weekEnd.setDate(weekStart.getDate() + 7);
	const startMs = weekStart.getTime();
	const endMs = weekEnd.getTime();
	return items.filter((item) => {
		if (!item.startAt) return false;
		const range = eventRangeMs(item);
		if (!range) return false;
		return range.start < endMs && range.end > startMs;
	});
}

export type WeekGridPlacement = {
	item: TemporalEventListItem;
	dayIndex: number;
	startMinutes: number;
	durationMinutes: number;
	virtualInstance?: boolean;
};

const DEFAULT_EVENT_DURATION_MIN = 60;
const WEEK_GRID_START_HOUR = 6;
const WEEK_GRID_END_HOUR = 22;

export function placementsForWeek(
	items: TemporalEventListItem[],
	weekStart: Date,
	timeZone: string
): WeekGridPlacement[] {
	const placements: WeekGridPlacement[] = [];
	const weekDays = buildWeekDays(weekStart);
	const weekEnd = new Date(weekStart);
	weekEnd.setDate(weekStart.getDate() + 7);

	for (const item of items) {
		if (!item.startAt || isOpenLoopListItem(item)) continue;

		const instances: Date[] = [new Date(item.startAt)];
		if (item.recurrenceRule) {
			const expanded = expandRruleOccurrences({
				rrule: item.recurrenceRule,
				dtstart: new Date(item.startAt),
				rangeStart: weekStart,
				rangeEnd: weekEnd
			});
			if (expanded.length > 0) instances.splice(0, instances.length, ...expanded);
		}

		const durationMin = item.durationMinutes ?? DEFAULT_EVENT_DURATION_MIN;

		for (const inst of instances) {
			const dayKey = localDayKeyFromIso(inst.toISOString(), timeZone);
			const dayIndex = weekDays.findIndex((d) => localViewDayKey(d) === dayKey);
			if (dayIndex < 0) continue;

			const hour = Number(
				new Intl.DateTimeFormat('en-US', {
					timeZone,
					hour: 'numeric',
					hour12: false
				}).format(inst)
			);
			const minute = Number(
				new Intl.DateTimeFormat('en-US', {
					timeZone,
					minute: 'numeric'
				}).format(inst)
			);
			const startMinutes = hour * 60 + minute;
			if (startMinutes < WEEK_GRID_START_HOUR * 60 || startMinutes > WEEK_GRID_END_HOUR * 60) {
				continue;
			}

			placements.push({
				item,
				dayIndex,
				startMinutes,
				durationMinutes: durationMin,
				virtualInstance: inst.getTime() !== new Date(item.startAt).getTime()
			});
		}
	}

	return placements;
}

export function overdueDebtMinutes(items: TemporalEventListItem[], now = new Date()): number {
	return items
		.filter(
			(i) =>
				!isTemporalEventCompleted(i) &&
				!isOpenLoopListItem(i) &&
				i.endAt &&
				new Date(i.endAt).getTime() < now.getTime()
		)
		.reduce((sum, i) => sum + (i.durationMinutes ?? DEFAULT_EVENT_DURATION_MIN), 0);
}

export { WEEK_GRID_START_HOUR, WEEK_GRID_END_HOUR };

export type TimelineShellView = 'today' | 'upcoming' | 'week' | 'agenda' | 'matrix';

export function filterItemsForTodayView(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): TemporalEventListItem[] {
	const todayKey = localDayKeyFromIso(now.toISOString(), timeZone);
	return items.filter((item) => {
		const section = agendaSectionForItem(item, now, timeZone);
		if (section === 'today' || section === 'unscheduled') return true;
		if (isTemporalEventCompleted(item) && item.startAt) {
			return localDayKeyFromIso(item.startAt, item.timezone?.trim() || timeZone) === todayKey;
		}
		return false;
	});
}

export function filterItemsForUpcomingView(
	items: TemporalEventListItem[],
	timeZone: string,
	now = new Date()
): TemporalEventListItem[] {
	return items.filter((item) => {
		if (isTemporalEventCompleted(item)) return false;
		const section = agendaSectionForItem(item, now, timeZone);
		return section === 'tomorrow' || section === 'this_week' || section === 'later';
	});
}

export function estimatedMinutesForItems(items: TemporalEventListItem[]): number {
	return items.reduce((sum, item) => sum + (item.durationMinutes ?? 30), 0);
}

export const PROJECT_GROUP_FALLBACK = '__no_project__';

export type ProjectGroup = {
	projectKey: string;
	projectLabel: string;
	items: TemporalEventListItem[];
};

export function groupByProject(
	items: TemporalEventListItem[],
	noProjectLabel: string,
	timeZone: string,
	now = new Date()
): ProjectGroup[] {
	const groups = new Map<string, { label: string; items: TemporalEventListItem[] }>();
	for (const item of items) {
		const label = item.projectLabel?.trim();
		const key = label ?? PROJECT_GROUP_FALLBACK;
		const displayLabel = label ?? noProjectLabel;
		const existing = groups.get(key);
		if (existing) {
			existing.items.push(item);
		} else {
			groups.set(key, { label: displayLabel, items: [item] });
		}
	}

	const result: ProjectGroup[] = [];
	for (const [projectKey, group] of groups) {
		group.items.sort((a, b) => focusScore(a, now, timeZone) - focusScore(b, now, timeZone));
		result.push({ projectKey, projectLabel: group.label, items: group.items });
	}

	return result.sort((a, b) => {
		if (a.projectKey === PROJECT_GROUP_FALLBACK) return 1;
		if (b.projectKey === PROJECT_GROUP_FALLBACK) return -1;
		return a.projectLabel.localeCompare(b.projectLabel);
	});
}

export function priorityDotColor(item: TemporalEventListItem): string {
	switch (item.priorityQuadrant) {
		case 'urgent_important':
			return '#ef4444';
		case 'urgent_not_important':
			return '#f97316';
		case 'not_urgent_important':
			return '#22c55e';
		default:
			return kindColor(item.kind);
	}
}

export function energyPillClasses(level: string): string {
	switch (level) {
		case 'deep':
			return 'bg-violet-500/15 text-violet-400 border-violet-500/25';
		case 'medium':
			return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
		case 'light':
			return 'bg-teal-500/15 text-teal-400 border-teal-500/25';
		default:
			return 'bg-muted/40 text-muted-foreground border-border';
	}
}

export function timelineGreetingPeriod(now: Date, timeZone: string): 'morning' | 'afternoon' | 'evening' {
	const hour = Number(
		new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(now)
	);
	if (hour < 12) return 'morning';
	if (hour < 17) return 'afternoon';
	return 'evening';
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

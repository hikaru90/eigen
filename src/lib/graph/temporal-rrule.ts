/**
 * Minimal RRULE expansion for week-view virtual instances.
 * Supports FREQ=DAILY|WEEKLY|MONTHLY with INTERVAL, COUNT, UNTIL, BYDAY.
 */

export type RruleExpansionInput = {
	rrule: string;
	dtstart: Date;
	rangeStart: Date;
	rangeEnd: Date;
};

function parseRruleParts(rrule: string): Map<string, string> {
	const body = rrule.trim().replace(/^RRULE:/i, '');
	const map = new Map<string, string>();
	for (const part of body.split(';')) {
		const [k, v] = part.split('=');
		if (k && v) map.set(k.toUpperCase(), v);
	}
	return map;
}

const WEEKDAY_MAP: Record<string, number> = {
	SU: 0,
	MO: 1,
	TU: 2,
	WE: 3,
	TH: 4,
	FR: 5,
	SA: 6
};

function parseUntil(value: string): Date | null {
	const trimmed = value.trim();
	if (/^\d{8}T\d{6}Z$/i.test(trimmed)) {
		const y = Number(trimmed.slice(0, 4));
		const m = Number(trimmed.slice(4, 6)) - 1;
		const d = Number(trimmed.slice(6, 8));
		const h = Number(trimmed.slice(9, 11));
		const min = Number(trimmed.slice(11, 13));
		const s = Number(trimmed.slice(13, 15));
		return new Date(Date.UTC(y, m, d, h, min, s));
	}
	if (/^\d{8}$/.test(trimmed)) {
		const y = Number(trimmed.slice(0, 4));
		const m = Number(trimmed.slice(4, 6)) - 1;
		const d = Number(trimmed.slice(6, 8));
		return new Date(Date.UTC(y, m, d, 23, 59, 59));
	}
	const parsed = new Date(trimmed);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setUTCDate(d.getUTCDate() + days);
	return d;
}

function addMonths(date: Date, months: number): Date {
	const d = new Date(date);
	d.setUTCMonth(d.getUTCMonth() + months);
	return d;
}

function matchesByDay(date: Date, byday: string): boolean {
	const days = byday.split(',').map((d) => d.trim().slice(-2).toUpperCase());
	const dow = date.getUTCDay();
	return days.some((d) => WEEKDAY_MAP[d] === dow);
}

/** Expand an RRULE into occurrence start instants within [rangeStart, rangeEnd). */
export function expandRruleOccurrences(input: RruleExpansionInput): Date[] {
	const parts = parseRruleParts(input.rrule);
	const freq = parts.get('FREQ')?.toUpperCase();
	if (!freq) return [];

	const interval = Math.max(1, Number.parseInt(parts.get('INTERVAL') ?? '1', 10) || 1);
	const count = parts.get('COUNT') ? Number.parseInt(parts.get('COUNT')!, 10) : null;
	const until = parts.get('UNTIL') ? parseUntil(parts.get('UNTIL')!) : null;
	const byday = parts.get('BYDAY');

	const occurrences: Date[] = [];
	let cursor = new Date(input.dtstart);
	let emitted = 0;
	const maxIterations = 500;

	for (let i = 0; i < maxIterations; i++) {
		if (count != null && emitted >= count) break;
		if (until && cursor.getTime() > until.getTime()) break;
		if (cursor.getTime() >= input.rangeEnd.getTime()) break;

		const inRange =
			cursor.getTime() >= input.rangeStart.getTime() && cursor.getTime() < input.rangeEnd.getTime();
		const dayOk = !byday || matchesByDay(cursor, byday);

		if (inRange && dayOk) {
			occurrences.push(new Date(cursor));
			emitted += 1;
		}

		if (freq === 'DAILY') {
			cursor = addDays(cursor, interval);
		} else if (freq === 'WEEKLY') {
			cursor = addDays(cursor, byday ? 1 : 7 * interval);
		} else if (freq === 'MONTHLY') {
			cursor = addMonths(cursor, interval);
		} else {
			break;
		}

		if (!byday && freq === 'WEEKLY' && emitted === 0 && cursor.getTime() < input.rangeStart.getTime()) {
			while (cursor.getTime() < input.rangeStart.getTime() && i < maxIterations) {
				cursor = addDays(cursor, 7 * interval);
				i += 1;
			}
		}
	}

	return occurrences;
}

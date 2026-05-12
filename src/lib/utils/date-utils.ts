const DAY_SHORT: Record<string, number> = {
	sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6
};

function parseDayName(s: string): number | null {
	return DAY_SHORT[s.toLowerCase().slice(0, 3)] ?? null;
}

function startOfUTCDay(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfUTCDay(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function lastWeekRange(): { from: Date; to: Date } {
	const now = new Date();
	const day = now.getUTCDay();
	const diffToMon = day === 0 ? 6 : day - 1;
	const thisMonday = new Date(now);
	thisMonday.setUTCDate(now.getUTCDate() - diffToMon);
	const from = new Date(thisMonday);
	from.setUTCDate(thisMonday.getUTCDate() - 7);
	const to = new Date(thisMonday);
	to.setUTCDate(thisMonday.getUTCDate() - 1);
	return { from: startOfUTCDay(from), to: endOfUTCDay(to) };
}

function lastMonthRange(): { from: Date; to: Date } {
	const now = new Date();
	const y = now.getUTCFullYear();
	const m = now.getUTCMonth();
	return {
		from: new Date(Date.UTC(y, m - 1, 1)),
		to: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
	};
}

function resolvePart(part: string, today: Date): Date | null {
	const p = part.trim().toLowerCase();
	if (p === 'today') return startOfUTCDay(today);
	if (p === 'yesterday') {
		const d = new Date(today);
		d.setUTCDate(d.getUTCDate() - 1);
		return startOfUTCDay(d);
	}

	const lastMatch = p.match(/^last\s+(.+)$/);
	if (lastMatch) {
		const dayIndex = parseDayName(lastMatch[1]);
		if (dayIndex !== null) {
			const currentDay = today.getUTCDay();
			let diff = currentDay - dayIndex;
			if (diff <= 0) diff += 7;
			const d = new Date(today);
			d.setUTCDate(today.getUTCDate() - diff);
			return startOfUTCDay(d);
		}
	}

	const thisMatch = p.match(/^this\s+(.+)$/);
	if (thisMatch) {
		const dayIndex = parseDayName(thisMatch[1]);
		if (dayIndex !== null) {
			const currentDay = today.getUTCDay();
			if (currentDay === dayIndex) return startOfUTCDay(today);
			let diff = currentDay - dayIndex;
			if (diff < 0) diff += 7;
			const d = new Date(today);
			d.setUTCDate(today.getUTCDate() - diff);
			return startOfUTCDay(d);
		}
	}

	return null;
}

export function parseNLDateRange(input: string): { from: Date; to: Date } | null {
	const trimmed = input.trim().toLowerCase();
	if (!trimmed) return null;

	if (trimmed === 'overall' || trimmed === 'all') return null;

	if (trimmed === 'last week') return lastWeekRange();
	if (trimmed === 'last month') return lastMonthRange();

	if (trimmed === 'this week') {
		const now = new Date();
		const day = now.getUTCDay();
		const diffToMon = day === 0 ? 6 : day - 1;
		const from = new Date(now);
		from.setUTCDate(now.getUTCDate() - diffToMon);
		return { from: startOfUTCDay(from), to: endOfUTCDay(now) };
	}

	if (trimmed === 'this month') {
		const now = new Date();
		return {
			from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
			to: endOfUTCDay(now)
		};
	}

	if (trimmed === 'today' || trimmed === 'yesterday') {
		const d = resolvePart(trimmed, new Date());
		if (d) return { from: d, to: endOfUTCDay(d) };
	}

	const daysMatch = trimmed.match(/^last\s+(\d+)\s+days?$/);
	if (daysMatch) {
		const n = parseInt(daysMatch[1], 10);
		const now = new Date();
		const from = new Date(now);
		from.setUTCDate(now.getUTCDate() - n);
		return { from: startOfUTCDay(from), to: endOfUTCDay(now) };
	}

	const parts = trimmed.split(/\s+(?:to|–|-)\s+/);
	if (parts.length === 2) {
		const today = new Date();
		const from = resolvePart(parts[0], today);
		const toPart = resolvePart(parts[1], today);
		if (from && toPart) return { from, to: endOfUTCDay(toPart) };
	}

	const single = resolvePart(trimmed, new Date());
	if (single) return { from: single, to: endOfUTCDay(single) };

	return null;
}

export function formatDateParam(d: Date): string {
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function formatDateRange(from?: string | null, to?: string | null): string {
	if (!from && !to) return 'All time';
	const fromStr = from ? DATE_FMT.format(new Date(from + 'T00:00:00Z')) : '';
	const toStr = to ? DATE_FMT.format(new Date(to + 'T23:59:59Z')) : '';
	if (from && to) return `${fromStr} – ${toStr}`;
	if (from) return `Since ${fromStr}`;
	return `Until ${toStr}`;
}

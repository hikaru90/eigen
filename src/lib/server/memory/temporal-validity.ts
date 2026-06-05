/**
 * Temporal validity helpers for Q&A context annotation.
 *
 * Uses stored `temporal_event.active_period` bounds from ingest. Recurring events
 * (`recurrenceRule`) are evaluated against the stored window only — full RRULE
 * expansion is out of scope for v1.
 */

export type TemporalEventValidityInput = {
	kind: string;
	semanticSummary: string;
	activePeriod: string;
};

export type TemporalEventValidity = TemporalEventValidityInput & {
	expired: boolean;
};

export type ThoughtTemporalStatus = 'none' | 'active' | 'expired';

/** Parsed Postgres half-open `tsrange` bounds. */
export type ActivePeriodBounds = {
	start: Date;
	end: Date;
};

const TSRANGE_LITERAL_RE =
	/^([\[\(])(\d{4}-\d{2}-\d{2}T[\d:.]+Z),(\d{4}-\d{2}-\d{2}T[\d:.]+Z)([\]\)])$/;

/**
 * Parse a Postgres `tsrange` literal into concrete Date bounds.
 * Supports half-open `[start,end)` form produced by ingest.
 */
export function parseActivePeriodLiteral(literal: string): ActivePeriodBounds {
	const trimmed = literal.trim();
	const match = TSRANGE_LITERAL_RE.exec(trimmed);
	if (!match) {
		throw new Error(`Invalid tsrange literal: ${literal}`);
	}
	const start = new Date(match[2]);
	const end = new Date(match[3]);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
		throw new Error(`Invalid tsrange dates: ${literal}`);
	}
	return { start, end };
}

/** True when `now` is at or past the half-open range end (period has ended). */
export function isActivePeriodExpired(activePeriod: string, now: Date): boolean {
	const { end } = parseActivePeriodLiteral(activePeriod);
	return now.getTime() >= end.getTime();
}

export function classifyThoughtTemporalStatus(
	events: TemporalEventValidityInput[],
	now: Date
): ThoughtTemporalStatus {
	if (events.length === 0) return 'none';
	const hasActive = events.some((e) => !isActivePeriodExpired(e.activePeriod, now));
	return hasActive ? 'active' : 'expired';
}

export function annotateTemporalEvents(
	events: TemporalEventValidityInput[],
	now: Date
): TemporalEventValidity[] {
	return events.map((e) => ({
		...e,
		expired: isActivePeriodExpired(e.activePeriod, now)
	}));
}

function formatPeriodDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatAsOfDate(now: Date): string {
	return now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Compact temporal annotation for compose prompts.
 * Returns empty string when there are no temporal events.
 */
export function formatTemporalAnnotation(
	events: TemporalEventValidity[],
	status: ThoughtTemporalStatus,
	now: Date
): string {
	if (status === 'none' || events.length === 0) return '';

	const parts = events.map((e) => {
		const { start } = parseActivePeriodLiteral(e.activePeriod);
		const summary = e.semanticSummary.trim() || e.kind;
		const dateLabel = formatPeriodDate(start.toISOString());
		const flag = e.expired ? 'EXPIRED' : 'ACTIVE';
		return `"${summary}" (${dateLabel}) — ${flag}`;
	});

	const prefix = `temporal: ${parts.join('; ')}`;
	if (status === 'expired') {
		return `${prefix} (all periods ended as of ${formatAsOfDate(now)})`;
	}
	return prefix;
}

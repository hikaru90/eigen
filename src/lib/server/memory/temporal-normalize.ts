import type { TemporalEventKind, TemporalTimePrecision } from '$lib/server/db/brain.schema';

export type ExtractedTemporalMention = {
	surface: string;
	kind: TemporalEventKind;
	/** ISO-8601 instant or date (start of period / point-in-time). */
	startAt: string;
	/** ISO-8601; omit for open-ended deadlines or point events. */
	endAt?: string;
	timePrecision: TemporalTimePrecision;
	timezone: string;
	isAllDay: boolean;
	recurrenceRule?: string;
	confidence: number;
	semanticSummary: string;
};

const ALLOWED_KINDS = new Set<TemporalEventKind>([
	'deadline',
	'appointment',
	'milestone',
	'period',
	'reminder',
	'inferred_event'
]);

const ALLOWED_PRECISIONS = new Set<TemporalTimePrecision>([
	'exact',
	'day',
	'week',
	'month',
	'fuzzy'
]);

/** Build a Postgres `tsrange` literal from normalized bounds. */
export function buildActivePeriodLiteral(start: Date, end: Date): string {
	const startIso = start.toISOString();
	const endIso = end.toISOString();
	return `[${startIso},${endIso})`;
}

/**
 * Expand a parsed instant/range into concrete Date bounds for storage and Falkor scalars.
 * Fuzzy precision uses a ±7 day window around start when end is absent.
 */
export function resolveTemporalBounds(mention: ExtractedTemporalMention): {
	start: Date;
	end: Date;
	activePeriodLiteral: string;
} {
	const start = new Date(mention.startAt);
	if (Number.isNaN(start.getTime())) {
		throw new Error(`Invalid temporal startAt: ${mention.startAt}`);
	}

	let end: Date;
	if (mention.endAt) {
		end = new Date(mention.endAt);
		if (Number.isNaN(end.getTime())) {
			throw new Error(`Invalid temporal endAt: ${mention.endAt}`);
		}
	} else if (mention.kind === 'deadline' || mention.kind === 'reminder') {
		// Open-ended commitment: point at due instant, range extends one day forward.
		end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
	} else if (mention.timePrecision === 'fuzzy') {
		end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
	} else if (mention.timePrecision === 'day' || mention.isAllDay) {
		end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
	} else if (mention.timePrecision === 'week') {
		end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
	} else if (mention.timePrecision === 'month') {
		end = new Date(start);
		end.setUTCMonth(end.getUTCMonth() + 1);
	} else {
		end = new Date(start.getTime() + 60 * 60 * 1000);
	}

	if (end.getTime() <= start.getTime()) {
		end = new Date(start.getTime() + 60 * 60 * 1000);
	}

	return {
		start,
		end,
		activePeriodLiteral: buildActivePeriodLiteral(start, end)
	};
}

export function parseTemporalMentions(content: string): ExtractedTemporalMention[] {
	const parsed = JSON.parse(content) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('Temporal extraction output must be a JSON array');
	}

	return parsed
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const surface =
				typeof (entry as { surface?: unknown }).surface === 'string'
					? (entry as { surface: string }).surface.trim()
					: '';
			const kindRaw =
				typeof (entry as { kind?: unknown }).kind === 'string'
					? (entry as { kind: string }).kind.trim()
					: '';
			const startAt =
				typeof (entry as { startAt?: unknown }).startAt === 'string'
					? (entry as { startAt: string }).startAt.trim()
					: '';
			const endAtRaw = (entry as { endAt?: unknown }).endAt;
			const endAt = typeof endAtRaw === 'string' && endAtRaw.trim() ? endAtRaw.trim() : undefined;
			const timePrecisionRaw =
				typeof (entry as { timePrecision?: unknown }).timePrecision === 'string'
					? (entry as { timePrecision: string }).timePrecision.trim()
					: 'fuzzy';
			const timezone =
				typeof (entry as { timezone?: unknown }).timezone === 'string'
					? (entry as { timezone: string }).timezone.trim()
					: 'UTC';
			const isAllDay = (entry as { isAllDay?: unknown }).isAllDay === true;
			const recurrenceRuleRaw = (entry as { recurrenceRule?: unknown }).recurrenceRule;
			const recurrenceRule =
				typeof recurrenceRuleRaw === 'string' && recurrenceRuleRaw.trim()
					? recurrenceRuleRaw.trim()
					: undefined;
			const confidenceRaw = (entry as { confidence?: unknown }).confidence;
			const confidence =
				typeof confidenceRaw === 'number' && !Number.isNaN(confidenceRaw)
					? Math.min(1, Math.max(0, confidenceRaw))
					: 0;
			const semanticSummary =
				typeof (entry as { semanticSummary?: unknown }).semanticSummary === 'string'
					? (entry as { semanticSummary: string }).semanticSummary.trim()
					: surface;

			if (!surface || !startAt || !ALLOWED_KINDS.has(kindRaw as TemporalEventKind)) return null;
			if (!ALLOWED_PRECISIONS.has(timePrecisionRaw as TemporalTimePrecision)) return null;

			return {
				surface,
				kind: kindRaw as TemporalEventKind,
				startAt,
				endAt,
				timePrecision: timePrecisionRaw as TemporalTimePrecision,
				timezone,
				isAllDay,
				recurrenceRule,
				confidence,
				semanticSummary: semanticSummary || surface
			};
		})
		.filter((v): v is ExtractedTemporalMention => v !== null);
}

import type {
	TemporalEnergyLevel,
	TemporalEventKind,
	TemporalPriorityQuadrant,
	TemporalTimePrecision
} from '$lib/server/db/brain.schema';
import {
	parseRelativeSpec,
	resolveAnchoredStartAt,
	type TemporalRelativeSpec
} from '$lib/server/memory/temporal-relative-resolve';

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
	durationMinutes?: number;
	energyLevel?: TemporalEnergyLevel;
	priorityQuadrant?: TemporalPriorityQuadrant;
	contextTags?: string[];
	/** Verbatim phrase of parent task in the same capture (resolved to parent_event_id on persist). */
	parentSurface?: string;
	confidence: number;
	semanticSummary: string;
	/** Structured relative-date spec — startAt is overridden by deterministic anchor math when set. */
	relativeSpec?: TemporalRelativeSpec;
};

const ALLOWED_ENERGY = new Set<TemporalEnergyLevel>(['light', 'medium', 'deep']);
const ALLOWED_QUADRANTS = new Set<TemporalPriorityQuadrant>([
	'urgent_important',
	'not_urgent_important',
	'urgent_not_important',
	'neither'
]);

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
 * Expand a parsed instant/range into concrete Date bounds for storage and AGE graph scalars.
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
			const relativeSpec = parseRelativeSpec((entry as { relativeSpec?: unknown }).relativeSpec);
			const durationRaw = (entry as { durationMinutes?: unknown }).durationMinutes;
			const durationMinutes =
				typeof durationRaw === 'number' && durationRaw > 0 ? Math.round(durationRaw) : undefined;
			const energyRaw = (entry as { energyLevel?: unknown }).energyLevel;
			const energyLevel =
				typeof energyRaw === 'string' && ALLOWED_ENERGY.has(energyRaw as TemporalEnergyLevel)
					? (energyRaw as TemporalEnergyLevel)
					: undefined;
			const quadrantRaw = (entry as { priorityQuadrant?: unknown }).priorityQuadrant;
			const priorityQuadrant =
				typeof quadrantRaw === 'string' &&
				ALLOWED_QUADRANTS.has(quadrantRaw as TemporalPriorityQuadrant)
					? (quadrantRaw as TemporalPriorityQuadrant)
					: undefined;
			const contextTagsRaw = (entry as { contextTags?: unknown }).contextTags;
			const contextTags = Array.isArray(contextTagsRaw)
				? contextTagsRaw
						.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
						.map((t) => t.trim())
				: undefined;
			const parentSurfaceRaw = (entry as { parentSurface?: unknown }).parentSurface;
			const parentSurface =
				typeof parentSurfaceRaw === 'string' && parentSurfaceRaw.trim()
					? parentSurfaceRaw.trim()
					: undefined;

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
				semanticSummary: semanticSummary || surface,
				...(relativeSpec ? { relativeSpec } : {}),
				...(durationMinutes != null ? { durationMinutes } : {}),
				...(energyLevel ? { energyLevel } : {}),
				...(priorityQuadrant ? { priorityQuadrant } : {}),
				...(contextTags && contextTags.length > 0 ? { contextTags } : {}),
				...(parentSurface ? { parentSurface } : {})
			};
		})
		.filter((v): v is ExtractedTemporalMention => v !== null);
}

/** Apply capture-anchored relative date math to LLM-extracted mentions. */
export function applyCaptureAnchoredMentions(
	mentions: ExtractedTemporalMention[],
	capturedAt: Date
): ExtractedTemporalMention[] {
	return mentions.map((mention) => {
		if (!mention.relativeSpec) return mention;
		const start = resolveAnchoredStartAt({
			startAt: mention.startAt,
			capturedAt,
			relativeSpec: mention.relativeSpec
		});
		return { ...mention, startAt: start.toISOString() };
	});
}

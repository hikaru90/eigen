/**
 * Deterministic timeline solver for ordering and duration questions.
 * Uses persisted temporal_event bounds — not LLM date arithmetic.
 */

import { parseActivePeriodLiteral } from '$lib/server/memory/temporal-validity';
import type { TemporalQuestionKind } from '$lib/server/retrieval/classify-query-intent';
import type { TemporalEventSeed } from '$lib/server/retrieval/temporal';

export type SolverTimelineEvent = {
	thoughtId: string;
	label: string;
	startAt: Date;
};

/** Reserved citation id for solver-derived ordering/duration facts in compose prompts. */
export const COMPUTED_TIMELINE_CITATION_ID = 'computed';

export type TemporalSolverResult = {
	kind: 'ordering' | 'duration' | 'unsupported';
	confidence: 'high' | 'low';
	events: SolverTimelineEvent[];
	ordering?: {
		earliest: SolverTimelineEvent;
		latest: SolverTimelineEvent;
	};
	durationDays?: {
		exclusive: number;
		inclusive: number;
		from: SolverTimelineEvent;
		to: SolverTimelineEvent;
	};
};

const MS_PER_DAY = 86_400_000;

export function calendarDaysBetweenExclusive(from: Date, to: Date): number {
	const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
	const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
	return Math.floor((toUtc - fromUtc) / MS_PER_DAY);
}

export function calendarDaysBetweenInclusive(from: Date, to: Date): number {
	return calendarDaysBetweenExclusive(from, to) + 1;
}

function normalizeLabel(value: string): string {
	return value.trim().toLowerCase();
}

/** Match LLM-provided entity hints to event summaries (hints come from classifier, not query regex). */
export function eventMatchesEntityHint(summary: string, hint: string): boolean {
	return scoreEntityHintMatch(summary, hint) > 0;
}

/** Higher score = stronger hint-to-summary match (used to pick best event per hint). */
export function scoreEntityHintMatch(summary: string, hint: string): number {
	const s = normalizeLabel(summary);
	const h = normalizeLabel(hint);
	if (!h) return 0;
	if (s === h) return 200;
	if (s.includes(h)) return 150 + Math.min(h.length, 40);
	if (h.includes(s) && s.length >= 3) return 120 + Math.min(s.length, 30);
	const summaryWords = s.split(/\s+/).filter((w) => w.length >= 3);
	const hintWords = h.split(/\s+/).filter((w) => w.length >= 3);
	let matchedHintWords = 0;
	for (const hintWord of hintWords) {
		for (const word of summaryWords) {
			if (word.startsWith(hintWord) || hintWord.startsWith(word)) {
				matchedHintWords++;
				break;
			}
		}
	}
	if (hintWords.length > 0 && matchedHintWords === hintWords.length) {
		return 80 + matchedHintWords * 10;
	}
	if (matchedHintWords > 0) return 40 + matchedHintWords * 5;
	return 0;
}

export function resolveEventStartAt(seed: TemporalEventSeed): Date | null {
	if (seed.startAt && !Number.isNaN(seed.startAt.getTime())) {
		return seed.startAt;
	}
	try {
		const { start } = parseActivePeriodLiteral(seed.activePeriod);
		return start;
	} catch {
		return null;
	}
}

export function seedsToTimelineEvents(seeds: TemporalEventSeed[]): SolverTimelineEvent[] {
	const events: SolverTimelineEvent[] = [];
	for (const seed of seeds) {
		const startAt = resolveEventStartAt(seed);
		if (!startAt) continue;
		events.push({
			thoughtId: seed.thoughtId,
			label: seed.semanticSummary.trim() || 'event',
			startAt
		});
	}
	return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

function pickEventsForHints(
	events: SolverTimelineEvent[],
	entityHints: string[]
): SolverTimelineEvent[] {
	if (entityHints.length === 0) return events;

	const matched: SolverTimelineEvent[] = [];
	const usedThoughtIds = new Set<string>();

	for (const hint of entityHints) {
		let best: { event: SolverTimelineEvent; score: number } | null = null;
		for (const event of events) {
			if (usedThoughtIds.has(event.thoughtId)) continue;
			const score = scoreEntityHintMatch(event.label, hint);
			if (score > 0 && (!best || score > best.score)) {
				best = { event, score };
			}
		}
		if (best) {
			matched.push(best.event);
			usedThoughtIds.add(best.event.thoughtId);
		}
	}

	if (entityHints.length >= 2 && matched.length < 2) {
		return [];
	}

	const pool = matched.length >= 2 ? matched : matched.length > 0 ? matched : events;
	return [...pool].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export function solveTemporalQuestion(input: {
	kind: TemporalQuestionKind;
	entityHints: string[];
	seeds: TemporalEventSeed[];
}): TemporalSolverResult {
	const timeline = seedsToTimelineEvents(input.seeds);
	if (timeline.length === 0) {
		return { kind: 'unsupported', confidence: 'low', events: [] };
	}

	if (input.kind === 'ordering') {
		const pool = pickEventsForHints(timeline, input.entityHints);
		if (pool.length < 2) {
			return { kind: 'unsupported', confidence: 'low', events: timeline };
		}
		const earliest = pool[0]!;
		const latest = pool[pool.length - 1]!;
		return {
			kind: 'ordering',
			confidence: 'high',
			events: timeline,
			ordering: { earliest, latest }
		};
	}

	if (input.kind === 'duration') {
		const pool = pickEventsForHints(timeline, input.entityHints);
		if (pool.length < 2) {
			return { kind: 'unsupported', confidence: 'low', events: timeline };
		}
		const from = pool[0]!;
		const to = pool[pool.length - 1]!;
		if (from.startAt.getTime() === to.startAt.getTime()) {
			return { kind: 'unsupported', confidence: 'low', events: timeline };
		}
		const [earlier, later] =
			from.startAt.getTime() <= to.startAt.getTime() ? [from, to] : [to, from];
		const exclusive = calendarDaysBetweenExclusive(earlier.startAt, later.startAt);
		const inclusive = calendarDaysBetweenInclusive(earlier.startAt, later.startAt);
		return {
			kind: 'duration',
			confidence: 'high',
			events: timeline,
			durationDays: { exclusive, inclusive, from: earlier, to: later }
		};
	}

	return { kind: 'unsupported', confidence: 'low', events: timeline };
}

export function allowsComputedTimelineCitation(result: TemporalSolverResult): boolean {
	return result.confidence === 'high' && result.events.length > 0;
}

export function formatComputedTimelineForPrompt(result: TemporalSolverResult): string {
	if (!allowsComputedTimelineCitation(result)) return '';

	const lines: string[] = [
		'Computed timeline (from temporal_event ledger — use these dates for Answer):',
		`Cite derived ordering or day-count conclusions with [id=${COMPUTED_TIMELINE_CITATION_ID}].`
	];

	for (const event of result.events) {
		const dateLabel = event.startAt.toISOString().slice(0, 10);
		lines.push(`- ${dateLabel}: ${event.label} [id=${event.thoughtId}]`);
	}

	if (result.kind === 'ordering' && result.ordering) {
		const { earliest, latest } = result.ordering;
		if (earliest.thoughtId !== latest.thoughtId) {
			lines.push(
				`Ordering: "${earliest.label}" (${earliest.startAt.toISOString().slice(0, 10)}) before "${latest.label}" (${latest.startAt.toISOString().slice(0, 10)})`
			);
		}
	}

	if (result.kind === 'duration' && result.durationDays) {
		const { exclusive, inclusive, from, to } = result.durationDays;
		lines.push(
			`Duration between "${from.label}" (${from.startAt.toISOString().slice(0, 10)}) and "${to.label}" (${to.startAt.toISOString().slice(0, 10)}): ${exclusive} calendar days (exclusive) / ${inclusive} calendar days (inclusive)`
		);
	}

	return `\n\n${lines.join('\n')}\n`;
}

function formatIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/**
 * Deterministic compose output when the solver has high confidence.
 * Avoids LLM reordering or day-count errors on ordering/duration questions.
 */
export function formatSolverAnswer(result: TemporalSolverResult): string | null {
	if (!allowsComputedTimelineCitation(result)) return null;

	if (result.kind === 'ordering' && result.ordering) {
		const { earliest, latest } = result.ordering;
		if (earliest.thoughtId === latest.thoughtId) return null;
		const earliestDate = formatIsoDate(earliest.startAt);
		const latestDate = formatIsoDate(latest.startAt);
		return [
			`Answer: "${earliest.label}" came first (${earliestDate}) [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
			'Evidence:',
			`- ${earliest.label} (${earliestDate}) [id=${earliest.thoughtId}]`,
			`- ${latest.label} (${latestDate}) [id=${latest.thoughtId}]`,
			`- Ordering: "${earliest.label}" before "${latest.label}" [id=${COMPUTED_TIMELINE_CITATION_ID}]`,
			'Unknown:',
			'- none'
		].join('\n');
	}

	if (result.kind === 'duration' && result.durationDays) {
		const { exclusive, from, to } = result.durationDays;
		const fromDate = formatIsoDate(from.startAt);
		const toDate = formatIsoDate(to.startAt);
		return [
			`Answer: ${exclusive} calendar days passed between "${from.label}" (${fromDate}) and "${to.label}" (${toDate}) [id=${COMPUTED_TIMELINE_CITATION_ID}].`,
			'Evidence:',
			`- ${from.label} (${fromDate}) [id=${from.thoughtId}]`,
			`- ${to.label} (${toDate}) [id=${to.thoughtId}]`,
			`- Duration: ${exclusive} calendar days (exclusive) between the two events [id=${COMPUTED_TIMELINE_CITATION_ID}]`,
			'Unknown:',
			'- none'
		].join('\n');
	}

	return null;
}

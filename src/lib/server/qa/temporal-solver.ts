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
	const s = normalizeLabel(summary);
	const h = normalizeLabel(hint);
	if (!h) return false;
	if (s.includes(h) || h.includes(s)) return true;
	const summaryWords = s.split(/\s+/).filter((w) => w.length >= 3);
	const hintWords = h.split(/\s+/).filter((w) => w.length >= 3);
	for (const hintWord of hintWords) {
		for (const word of summaryWords) {
			if (word.startsWith(hintWord) || hintWord.startsWith(word)) return true;
		}
	}
	return false;
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
	for (const hint of entityHints) {
		const hit = events.find((e) => eventMatchesEntityHint(e.label, hint));
		if (hit && !matched.some((m) => m.thoughtId === hit.thoughtId)) {
			matched.push(hit);
		}
	}
	const pool = matched.length > 0 ? matched : events;
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
		if (entityHintsRequirePair(input.entityHints) && pool.length < input.entityHints.length) {
			return { kind: 'unsupported', confidence: 'low', events: timeline };
		}
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

function entityHintsRequirePair(hints: string[]): boolean {
	return hints.length >= 2;
}

export function formatComputedTimelineForPrompt(result: TemporalSolverResult): string {
	if (result.confidence !== 'high') return '';

	const lines: string[] = [
		'Computed timeline (from temporal_event ledger — use these dates for Answer):'
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

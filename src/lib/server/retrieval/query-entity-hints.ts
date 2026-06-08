/**
 * Entity hints from the LLM query-intent classifier — deduped only, no question-text parsing.
 *
 * XXX REMOVED — regex extraction of quoted phrases, or-alternatives, and duration endpoints
 * from question text. See `.cursor/rules/no-string-heuristics.mdc`.
 */

import type { TemporalQuestionKind } from '$lib/server/retrieval/classify-query-intent';
import type { TemporalSolverResult } from '$lib/server/qa/temporal-solver';
import { formatSolverAnswer } from '$lib/server/qa/temporal-solver';

/** Dedupe and trim LLM classifier entityHints — does not parse the question string. */
export function mergeQuestionEntityHints(classifierHints: string[]): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();

	for (const hint of classifierHints) {
		const trimmed = hint.trim();
		const key = trimmed;
		if (!trimmed || seen.has(key)) continue;
		seen.add(key);
		merged.push(trimmed);
	}

	return merged;
}

/** Kinds that bypass the compose LLM when the solver has high confidence. */
const DETERMINISTIC_SOLVER_KINDS: TemporalQuestionKind[] = [
	'ordering',
	'multi_ordering',
	'duration',
	'count',
	'lookback',
	'span'
];

/** Gate deterministic compose bypass — avoids wrong ordering answers on fact-lookup questions. */
export function shouldUseDeterministicSolverAnswer(input: {
	intentKind: TemporalQuestionKind;
	solverResult: TemporalSolverResult;
	/** From LLM query-intent classifier — true for A-vs-B ordering, false for fact-after-anchor lookups. */
	comparativeOrdering: boolean;
}): boolean {
	if (!formatSolverAnswer(input.solverResult)) return false;
	if (input.intentKind !== input.solverResult.kind) return false;
	if (!DETERMINISTIC_SOLVER_KINDS.includes(input.intentKind)) return false;
	if (input.intentKind === 'ordering' && !input.comparativeOrdering) {
		return false;
	}
	return true;
}

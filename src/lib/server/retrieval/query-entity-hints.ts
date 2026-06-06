/**
 * Structural entity-hint extraction from question text (quoted phrases, or-alternatives).
 * Supplements LLM classifier hints — does not replace semantic classification.
 */

import type { TemporalQuestionKind } from '$lib/server/retrieval/classify-query-intent';
import type { TemporalSolverResult } from '$lib/server/qa/temporal-solver';
import { formatSolverAnswer } from '$lib/server/qa/temporal-solver';

/** Verbatim quoted phrases from the question (single or double quotes). */
export function extractQuotedPhrases(question: string): string[] {
	const phrases: string[] = [];
	for (const match of question.matchAll(/'([^']+)'|"([^"]+)"/g)) {
		const phrase = (match[1] ?? match[2])?.trim();
		if (phrase && phrase.length > 0) phrases.push(phrase);
	}
	return phrases;
}

/** Alternatives in comparative ordering questions ("… first, X or Y?"). */
export function extractOrAlternativePair(question: string): string[] {
	const patterns = [
		/\bfirst,?\s+(.+?)\s+or\s+(?:the\s+)?(.+?)\?/i,
		/,\s*(?:the\s+)?(.+?)\s+or\s+(?:the\s+)?(.+?)\?/i
	];
	for (const pattern of patterns) {
		const match = question.match(pattern);
		if (match?.[1] && match[2]) {
			return [match[1].trim(), match[2].trim()];
		}
	}
	return [];
}

/** Duration endpoint phrases from "… to X after Y" style questions. */
export function extractDurationEndpointHints(question: string): string[] {
	const hints: string[] = [];

	const afterMatch = question.match(/\bafter\s+(.+?)\?/i);
	if (afterMatch?.[1]) {
		const chunk = afterMatch[1].trim();
		if (chunk.length >= 3) hints.push(chunk);
	}

	const leadMatch = question.match(
		/(?:how many days|how long).+?(?:to|for me to)\s+(.+?)\s+after\s+/i
	);
	if (leadMatch?.[1]) {
		const phrase = leadMatch[1].trim();
		if (phrase.length >= 3) hints.push(phrase);
	}

	const beforeMatch = question.match(
		/(?:how many days|how long).+?\s+before\s+(?:the\s+)?(.+?)\s+did\s+/i
	);
	if (beforeMatch?.[1]) {
		const phrase = beforeMatch[1].trim();
		if (phrase.length >= 3) hints.push(phrase);
	}

	const beforeDidMatch = question.match(/\bbefore\s+(?:the\s+)?(.+?)\s+did\s+/i);
	if (beforeDidMatch?.[1]) {
		const phrase = beforeDidMatch[1].trim();
		if (phrase.length >= 3) hints.push(phrase);
	}

	const betweenMatch = question.match(
		/between\s+(?:the\s+)?(.+?)\s+and\s+(?:the\s+)?(.+?)\?/i
	);
	if (betweenMatch?.[1] && betweenMatch[2]) {
		hints.push(betweenMatch[1].trim(), betweenMatch[2].trim());
	}

	return hints;
}

export function mergeQuestionEntityHints(classifierHints: string[], question: string): string[] {
	const merged = [...classifierHints];
	const seen = new Set(merged.map((h) => h.toLowerCase()));

	const quoted = extractQuotedPhrases(question);
	const orPair = quoted.length >= 2 ? [] : extractOrAlternativePair(question);

	for (const hint of [...quoted, ...orPair, ...extractDurationEndpointHints(question)]) {
		const key = hint.toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		merged.push(hint);
	}

	return merged;
}

export function hasComparativeOrderingStructure(question: string): boolean {
	return extractQuotedPhrases(question).length >= 2 || extractOrAlternativePair(question).length >= 2;
}

/** Gate deterministic compose bypass — avoids wrong ordering answers on fact-lookup questions. */
export function shouldUseDeterministicSolverAnswer(input: {
	intentKind: TemporalQuestionKind;
	solverResult: TemporalSolverResult;
	question: string;
}): boolean {
	if (!formatSolverAnswer(input.solverResult)) return false;
	if (input.intentKind !== input.solverResult.kind) return false;
	if (input.intentKind !== 'ordering' && input.intentKind !== 'duration') return false;
	if (input.intentKind === 'ordering' && !hasComparativeOrderingStructure(input.question)) {
		return false;
	}
	return true;
}

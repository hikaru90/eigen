import type { LongMemEvalInstance, LongMemEvalTurn } from './types';

/** Parse LongMemEval haystack/question dates (e.g. `2023/05/28 (Sun) 07:17` or `2023-03-01`). */
export function parseLongMemEvalSessionDate(value: string): Date {
	const trimmed = value.trim();
	const match = trimmed.match(
		/^(\d{4})[/-](\d{2})[/-](\d{2})(?:\s+\([^)]+\)\s+(\d{2}):(\d{2}))?/
	);
	if (match) {
		const year = Number(match[1]);
		const month = Number(match[2]) - 1;
		const day = Number(match[3]);
		const hour = match[4] != null ? Number(match[4]) : 12;
		const minute = match[5] != null ? Number(match[5]) : 0;
		return new Date(Date.UTC(year, month, day, hour, minute));
	}
	const fallback = new Date(trimmed);
	if (!Number.isNaN(fallback.getTime())) return fallback;
	throw new Error(`Unparseable LongMemEval session date: ${value}`);
}

export function formatSessionAsCapture(
	sessionDate: string,
	sessionId: string,
	turns: LongMemEvalTurn[]
): string {
	const lines = [`Chat session (${sessionId}) on ${sessionDate}:`];
	for (const turn of turns) {
		const speaker = turn.role === 'user' ? 'User' : 'Assistant';
		lines.push(`${speaker}: ${turn.content}`);
	}
	return lines.join('\n');
}

export function formatTurnAsCapture(sessionDate: string, sessionId: string, turn: LongMemEvalTurn): string {
	const speaker = turn.role === 'user' ? 'User' : 'Assistant';
	return `Chat session (${sessionId}) on ${sessionDate} — ${speaker}: ${turn.content}`;
}

export type LongMemEvalCaptureGranularity = 'session' | 'turn' | 'user-turn';

export type LongMemEvalCaptureItem = {
	id: string;
	rawText: string;
	/** Session timestamp for temporal extraction anchor (relative dates in capture text). */
	capturedAt: Date;
};

export function instanceToCaptureItems(
	instance: LongMemEvalInstance,
	granularity: LongMemEvalCaptureGranularity = 'user-turn'
): LongMemEvalCaptureItem[] {
	const items: LongMemEvalCaptureItem[] = [];

	for (let sessionIndex = 0; sessionIndex < instance.haystack_session_ids.length; sessionIndex++) {
		const sessionId = instance.haystack_session_ids[sessionIndex]!;
		const sessionDate = instance.haystack_dates[sessionIndex] ?? instance.question_date;
		const capturedAt = parseLongMemEvalSessionDate(sessionDate);
		const turns = instance.haystack_sessions[sessionIndex] ?? [];

		if (granularity === 'session') {
			items.push({
				id: sessionId,
				rawText: formatSessionAsCapture(sessionDate, sessionId, turns),
				capturedAt
			});
			continue;
		}

		for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
			const turn = turns[turnIndex]!;
			if (granularity === 'user-turn' && turn.role !== 'user') continue;
			items.push({
				id: `${sessionId}_${turnIndex + 1}`,
				rawText: formatTurnAsCapture(sessionDate, sessionId, turn),
				capturedAt
			});
		}
	}

	return items;
}

/** Stable auth/brain tenant id fragment from a benchmark question id. */
export function sanitizeQuestionIdForUserId(questionId: string): string {
	const sanitized = questionId.replace(/[^a-zA-Z0-9_-]/g, '_');
	return sanitized.length > 0 ? sanitized.slice(0, 80) : 'unknown';
}

export function corpusUserIdForQuestion(questionId: string): string {
	return `longmemeval-corpus-${sanitizeQuestionIdForUserId(questionId)}`;
}

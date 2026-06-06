import type { LongMemEvalInstance, LongMemEvalTurn } from './types';

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

export function instanceToCaptureItems(
	instance: LongMemEvalInstance,
	granularity: LongMemEvalCaptureGranularity = 'user-turn'
): Array<{ id: string; rawText: string }> {
	const items: Array<{ id: string; rawText: string }> = [];

	for (let sessionIndex = 0; sessionIndex < instance.haystack_session_ids.length; sessionIndex++) {
		const sessionId = instance.haystack_session_ids[sessionIndex]!;
		const sessionDate = instance.haystack_dates[sessionIndex] ?? instance.question_date;
		const turns = instance.haystack_sessions[sessionIndex] ?? [];

		if (granularity === 'session') {
			items.push({
				id: sessionId,
				rawText: formatSessionAsCapture(sessionDate, sessionId, turns)
			});
			continue;
		}

		for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
			const turn = turns[turnIndex]!;
			if (granularity === 'user-turn' && turn.role !== 'user') continue;
			items.push({
				id: `${sessionId}_${turnIndex + 1}`,
				rawText: formatTurnAsCapture(sessionDate, sessionId, turn)
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

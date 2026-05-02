/**
 * Deterministic ingest retry budget (AC-015, AC-016).
 * Caller supplies the async operation; this wrapper applies exactly `maxAttempts` tries
 * (initial + retries), so total attempts = 1 + maxRetries.
 */
export const INGEST_MAX_RETRIES = 3 as const;

export type RetryExhaustedError = Error & { attempts: number; lastCause: unknown };

export function isRetryExhaustedError(e: unknown): e is RetryExhaustedError {
	return e instanceof Error && 'attempts' in e && 'lastCause' in e;
}

export async function runIngestWithRetries<T>(
	op: () => Promise<T>,
	maxRetries: number = INGEST_MAX_RETRIES
): Promise<T> {
	let lastCause: unknown;
	const maxAttempts = 1 + maxRetries;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await op();
		} catch (e) {
			lastCause = e;
			if (attempt === maxAttempts) break;
		}
	}
	const err = new Error(
		`Ingest failed after ${maxAttempts} attempts (initial + ${maxRetries} retries). Last error: ${String(lastCause)}`
	) as RetryExhaustedError;
	err.attempts = maxAttempts;
	err.lastCause = lastCause;
	throw err;
}

import type { EvalEntryKind } from '$lib/server/db/brain.schema';
import { EVAL_ENTRY_TIMEOUT_MS_DEFAULT } from './eval-config';

function parsePositiveMs(raw: string, envName: string): number {
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error(`${envName} must be a positive number, got: ${raw}`);
	}
	return parsed;
}

/** Per-entry wall clock (capture/edit include full inline enrich + judge). */
export function resolveEntryTimeoutMs(kind: EvalEntryKind | string): number {
	const raw = process.env.EVAL_ENTRY_TIMEOUT_MS?.trim();
	if (raw) return parsePositiveMs(raw, 'EVAL_ENTRY_TIMEOUT_MS');
	if (kind === 'capture' || kind === 'edit') {
		return EVAL_ENTRY_TIMEOUT_MS_DEFAULT;
	}
	return 10 * 60 * 1000;
}

export async function withEvalEntryTimeout<T>(
	timeoutMs: number,
	label: string,
	fn: () => Promise<T>
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			fn(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`[eval] ${label} timed out after ${timeoutMs}ms`)),
					timeoutMs
				);
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

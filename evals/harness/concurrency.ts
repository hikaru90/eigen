/**
 * Bounded parallel map for eval harness scripts (seed, relation wiring, etc.).
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results = new Array<R>(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		while (true) {
			const index = next;
			next += 1;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	}

	await Promise.all(Array.from({ length: limit }, () => worker()));
	return results;
}

function parsePositiveInt(raw: string | undefined, label: string): number | null {
	if (raw == null || !raw.trim()) return null;
	const parsed = Number(raw.trim());
	if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
		throw new Error(`[eval] ${label} must be a positive integer, got: ${raw}`);
	}
	return parsed;
}

/** CLI `--seed-concurrency N` overrides `EVAL_SEED_CONCURRENCY`. Default 8. */
export function resolveSeedConcurrency(cliValue?: number): number {
	if (cliValue != null) {
		if (!Number.isFinite(cliValue) || cliValue < 1 || !Number.isInteger(cliValue)) {
			throw new Error(`[eval] --seed-concurrency must be a positive integer, got: ${cliValue}`);
		}
		return cliValue;
	}
	return parsePositiveInt(process.env.EVAL_SEED_CONCURRENCY, 'EVAL_SEED_CONCURRENCY') ?? 8;
}

/** `EVAL_RELATION_WIRE_CONCURRENCY` or default 16. */
export function resolveRelationWireConcurrency(): number {
	return parsePositiveInt(process.env.EVAL_RELATION_WIRE_CONCURRENCY, 'EVAL_RELATION_WIRE_CONCURRENCY') ?? 16;
}

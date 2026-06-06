import { BACKGROUND_ENRICH_POLL_MS } from '$lib/capture/poll-enrichment';

export type EnrichPendingSnapshot = { thoughtIds: string[] };

export async function fetchEnrichPendingSnapshot(): Promise<EnrichPendingSnapshot> {
	const res = await fetch('/api/capture/enrich-pending');
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || `Failed to load enrich queue (${res.status})`);
	}
	const body = (await res.json()) as EnrichPendingSnapshot;
	return { thoughtIds: body.thoughtIds ?? [] };
}

/**
 * Poll tier-2 enrich queue and invoke `onEnrichComplete` when a watched thought leaves
 * the pending/processing set (enrichment finished or failed out of queue).
 */
export function pollGraphEnrichRefresh(input: {
	onEnrichComplete: () => void | Promise<void>;
	pollMs?: number;
}): () => void {
	const pollMs = input.pollMs ?? BACKGROUND_ENRICH_POLL_MS;
	let cancelled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastPending = new Set<string>();

	const tick = async () => {
		if (cancelled) return;
		try {
			const { thoughtIds } = await fetchEnrichPendingSnapshot();
			const current = new Set(thoughtIds);
			for (const id of lastPending) {
				if (!current.has(id)) {
					await input.onEnrichComplete();
					break;
				}
			}
			lastPending = current;
		} catch {
			// Transient errors — retry on next interval.
		}
		if (cancelled) return;
		timer = setTimeout(() => {
			void tick();
		}, pollMs);
	};

	void tick();

	return () => {
		cancelled = true;
		if (timer !== undefined) clearTimeout(timer);
	};
}

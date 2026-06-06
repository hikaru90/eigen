import { mergeRecentCaptureFromServer, type RecentCaptureSyncPayload } from './merge-recent-capture-sync';
import type {
	CaptureRecentThoughtSnippet,
	CaptureSubmitResult
} from './capture-result-types';

export const CAPTURE_RECENT_SYNC_POLL_MS = 1500;

export async function fetchRecentCaptureSyncPayload(): Promise<RecentCaptureSyncPayload> {
	const res = await fetch('/api/capture/recent');
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || `Failed to load recent captures (${res.status})`);
	}
	return (await res.json()) as RecentCaptureSyncPayload;
}

/**
 * Poll recent capture list so MCP / other-tab ingests appear on the capture page
 * with live enrich status updates.
 */
export function pollCaptureRecentSync(input: {
	limit: number;
	getState: () => {
		snippets: CaptureRecentThoughtSnippet[];
		details: Record<string, CaptureSubmitResult>;
	};
	onSync: (next: {
		snippets: CaptureRecentThoughtSnippet[];
		details: Record<string, CaptureSubmitResult>;
		newThoughtIds: string[];
	}) => void;
	pollMs?: number;
}): () => void {
	const pollMs = input.pollMs ?? CAPTURE_RECENT_SYNC_POLL_MS;
	let cancelled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const tick = async () => {
		if (cancelled) return;
		try {
			const payload = await fetchRecentCaptureSyncPayload();
			const { snippets, details } = input.getState();
			const merged = mergeRecentCaptureFromServer(snippets, details, payload, input.limit);
			const detailChanged = payload.recentThoughtDetails.some((thought) => {
				const prior = details[thought.id];
				if (!prior) return false;
				const priorSnippet = snippets.find((row) => row.id === thought.id);
				const incomingSnippet = payload.recentThoughts.find((row) => row.id === thought.id);
				return (
					prior.queueStatus !== thought.queueStatus ||
					prior.enrichmentComplete !== thought.enrichmentComplete ||
					prior.queueError !== thought.queueError ||
					prior.category !== thought.category ||
					prior.memoryType !== thought.memoryType ||
					prior.normalizedText !== thought.normalizedText ||
					priorSnippet?.category !== incomingSnippet?.category ||
					priorSnippet?.memoryType !== incomingSnippet?.memoryType
				);
			});
			const listChanged =
				merged.removedThoughtIds.length > 0 ||
				merged.newThoughtIds.length > 0 ||
				merged.snippets.length !== snippets.length ||
				merged.snippets.some((row, index) => snippets[index]?.id !== row.id);
			if (listChanged || detailChanged) {
				input.onSync(merged);
			}
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

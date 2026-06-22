import type {
	CaptureRecentThoughtSnippet,
	CaptureSubmitResult
} from '$lib/capture/capture-result-types';

export type RecentCaptureSyncPayload = {
	recentThoughts: CaptureRecentThoughtSnippet[];
	recentThoughtDetails: CaptureSubmitResult[];
};

/** Merge server recent list into local capture page state (MCP, other tabs, etc.). */
export function mergeRecentCaptureFromServer(
	existingSnippets: CaptureRecentThoughtSnippet[],
	existingDetails: Record<string, CaptureSubmitResult>,
	incoming: RecentCaptureSyncPayload,
	limit: number
): {
	snippets: CaptureRecentThoughtSnippet[];
	details: Record<string, CaptureSubmitResult>;
	newThoughtIds: string[];
	removedThoughtIds: string[];
} {
	const serverSnippets = incoming.recentThoughts.slice(0, limit);
	const serverIds = new Set(serverSnippets.map((row) => row.id));
	const existingIds = new Set(existingSnippets.map((row) => row.id));

	const newThoughtIds = serverSnippets.filter((row) => !existingIds.has(row.id)).map((row) => row.id);

	// In-flight UI captures can appear before /api/capture/recent includes them; do not drop those rows.
	const retainedLocalSnippets = existingSnippets.filter((row) => {
		if (serverIds.has(row.id)) return false;
		const detail = existingDetails[row.id];
		if (detail === undefined) return true;
		return !detail.enrichmentComplete;
	});

	const removedThoughtIds = existingSnippets
		.filter((row) => {
			if (serverIds.has(row.id)) return false;
			if (retainedLocalSnippets.some((kept) => kept.id === row.id)) return false;
			return true;
		})
		.map((row) => row.id);

	const retainedIds = new Set(retainedLocalSnippets.map((row) => row.id));
	const snippets = [
		...retainedLocalSnippets,
		...serverSnippets.filter((row) => !retainedIds.has(row.id))
	].slice(0, limit);

	const nextDetails = { ...existingDetails };
	for (const thought of incoming.recentThoughtDetails) {
		nextDetails[thought.id] = thought;
	}
	for (const id of removedThoughtIds) {
		delete nextDetails[id];
	}

	return {
		snippets,
		details: nextDetails,
		newThoughtIds,
		removedThoughtIds
	};
}

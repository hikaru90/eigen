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
	const snippets = incoming.recentThoughts.slice(0, limit);
	const serverIds = new Set(snippets.map((row) => row.id));
	const existingIds = new Set(existingSnippets.map((row) => row.id));

	const newThoughtIds = snippets.filter((row) => !existingIds.has(row.id)).map((row) => row.id);
	const removedThoughtIds = existingSnippets
		.filter((row) => !serverIds.has(row.id))
		.map((row) => row.id);

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

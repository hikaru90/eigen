import type {
	CaptureRecentThoughtSnippet,
	CaptureSubmitResult
} from '$lib/capture/capture-result-types';
import { loadThoughtCaptureResult } from '$lib/server/capture/capture-result';
import { listThoughts } from '$lib/server/capture/service';

export const RECENT_CAPTURE_THOUGHTS_LIMIT = 8;

export type RecentCaptureThoughtsPayload = {
	recentThoughts: CaptureRecentThoughtSnippet[];
	recentThoughtDetails: CaptureSubmitResult[];
};

/** Recent capture list for the capture page and its refresh API. */
export async function loadRecentCaptureThoughts(
	userId: string,
	limit = RECENT_CAPTURE_THOUGHTS_LIMIT
): Promise<RecentCaptureThoughtsPayload> {
	const recentRows = await listThoughts(userId, {
		fields: 'snippet',
		limit
	});
	const recentThoughtDetails = await Promise.all(
		recentRows.map((row) => loadThoughtCaptureResult(userId, row.id))
	);
	return {
		recentThoughts: recentRows.map((row) => ({
			id: row.id,
			normalizedText: row.normalizedText,
			category: row.category,
			memoryType: row.memoryType,
			createdAt: row.createdAt.toISOString()
		})),
		recentThoughtDetails
	};
}

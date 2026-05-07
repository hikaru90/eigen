import { captureThought, editStoredThought, listThoughts } from '$lib/server/capture/service';
import { searchThoughts } from '$lib/server/retrieval/service';
import { validateNonEmptyEntityId, validateSearchParams } from '$lib/server/validation/mcp-args';

export type McpToolContext = {
	userId: string;
};

function asObject(input: unknown): Record<string, unknown> {
	return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

export async function runCaptureThoughtTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const raw = typeof body.raw === 'string' ? body.raw : '';
	if (!raw.trim()) {
		throw new Error('raw is required');
	}
	const stored = await captureThought(context.userId, raw);
	return { thoughtId: stored.id, thought: stored };
}

export async function runListThoughtsTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const limit = typeof body.limit === 'number' ? body.limit : 20;
	const cursorCreatedAt =
		typeof body.cursor_created_at === 'string' ? new Date(body.cursor_created_at) : undefined;
	const cursorId = typeof body.cursor_id === 'string' ? body.cursor_id : undefined;
	const thoughts = await listThoughts(context.userId, {
		limit,
		cursor:
			cursorCreatedAt && cursorId
				? {
						createdAt: cursorCreatedAt,
						id: cursorId
					}
				: undefined
	});
	return { thoughts };
}

export async function runSearchThoughtsTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const query = typeof body.query === 'string' ? body.query.trim() : '';
	if (!query) {
		throw new Error('query is required');
	}
	const topK = typeof body.top_k === 'number' ? body.top_k : undefined;
	const threshold = typeof body.threshold === 'number' ? body.threshold : undefined;
	validateSearchParams({ topK, threshold });
	const results = await searchThoughts({
		userId: context.userId,
		query,
		topK: topK ?? 20
	});
	const filtered = threshold == null ? results : results.filter((result) => result.score >= threshold);
	return { results: filtered };
}

export async function runEditThoughtTool(context: McpToolContext, args: unknown) {
	const body = asObject(args);
	const thoughtId = validateNonEmptyEntityId(
		typeof body.thought_id === 'string' ? body.thought_id : '',
		'thought_id'
	);
	const editRequest = typeof body.edit_request === 'string' ? body.edit_request.trim() : '';
	if (!editRequest) {
		throw new Error('edit_request is required');
	}
	const updated = await editStoredThought(context.userId, thoughtId, editRequest);
	if (!updated.ok) {
		throw new Error('Thought not found');
	}
	return { thought: updated.thought };
}

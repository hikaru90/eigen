import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchThoughts } from '$lib/server/retrieval/service';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { tryRecordRetrievalQualityEvent } from '$lib/server/retrieval/quality-telemetry';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const b = typeof body === 'object' && body ? (body as { query?: unknown; topK?: unknown }) : {};
	const query = typeof b.query === 'string' ? b.query : '';
	const topK = typeof b.topK === 'number' ? b.topK : 20;

	if (!query.trim()) error(400, 'query is required');
	if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
		error(400, 'topK must be an integer between 1 and 100');
	}

	const weights = CONTEXT_WEIGHTS.default;
	const results = await searchThoughts({
		userId: user.id,
		query,
		topK,
		weights
	});
	void tryRecordRetrievalQualityEvent({
		userId: user.id,
		surface: 'api',
		weights,
		topKRequested: topK,
		results: results.map((r) => ({ vectorScore: r.vectorScore, graphScore: r.graphScore }))
	});

	return json({ results });
};

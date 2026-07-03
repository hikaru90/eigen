import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { loadSpendProbeSnapshot } from '$lib/server/e2e/graph-scale-spend';

export const GET: RequestHandler = async ({ url }) => {
	if (!dev) {
		return json({ error: 'Graph-scale spend API only available in dev mode' }, { status: 403 });
	}

	const userId = url.searchParams.get('userId')?.trim();
	if (!userId) {
		error(400, 'userId is required');
	}
	if (!userId.startsWith('graph-scale-spend-')) {
		error(400, 'userId must be a graph-scale spend probe user');
	}

	const snapshot = await loadSpendProbeSnapshot(userId);
	return json(snapshot);
};

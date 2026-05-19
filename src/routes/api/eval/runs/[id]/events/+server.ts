import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { listEvalEvents } from '$lib/eval/store';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!dev) return json({ error: 'Eval API only available in dev mode' }, { status: 403 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
	const events = await listEvalEvents(locals.user.id, params.id, limit);
	return json({
		events: events.reverse().map((e) => ({
			id: e.id,
			entryId: e.entryId,
			level: e.level,
			message: e.message,
			createdAt: e.createdAt.toISOString()
		}))
	});
};

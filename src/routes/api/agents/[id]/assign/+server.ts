import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assignThoughtToAgent } from '$lib/server/agents/assign-thought';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await event.request.json().catch(() => ({}));
	const thoughtId = typeof body.thoughtId === 'string' ? body.thoughtId.trim() : '';
	if (!thoughtId) return json({ error: 'thoughtId is required' }, { status: 400 });

	try {
		const result = await assignThoughtToAgent({
			userId: user.id,
			agentId: event.params.id,
			thoughtId
		});
		return json(result, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = message.includes('not found') ? 404 : 400;
		return json({ error: message }, { status });
	}
};

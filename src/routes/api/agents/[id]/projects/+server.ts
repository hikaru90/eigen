import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { bindAgentToProject, listAgentProjectBindings } from '$lib/server/agents/service';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const bindings = await listAgentProjectBindings(user.id, event.params.id);
	return json({ bindings });
};

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await event.request.json().catch(() => ({}));
	const projectEntityId = typeof body.projectEntityId === 'string' ? body.projectEntityId.trim() : '';
	if (!projectEntityId) return json({ error: 'projectEntityId is required' }, { status: 400 });

	try {
		const result = await bindAgentToProject({
			userId: user.id,
			agentId: event.params.id,
			projectEntityId
		});
		return json(result, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = message.includes('not found') ? 404 : 400;
		return json({ error: message }, { status });
	}
};

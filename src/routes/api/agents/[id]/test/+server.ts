import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { emitAgentEvent } from '$lib/server/agents/emit';
import { randomUUID } from 'node:crypto';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const result = await emitAgentEvent({
		userId: user.id,
		agentId: event.params.id,
		eventType: 'webhook.test',
		eventId: randomUUID(),
		payload: { message: 'Eigenmesh webhook test' }
	});

	return json({ ok: true, deliveries: result.deliveries });
};

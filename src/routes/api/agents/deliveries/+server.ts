import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listWebhookDeliveries } from '$lib/server/agents/service';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const deliveries = await listWebhookDeliveries(user.id);
	return json({ deliveries });
};

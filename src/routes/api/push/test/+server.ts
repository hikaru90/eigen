import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sendPushToUser } from '$lib/server/push/send';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	try {
		const result = await sendPushToUser(user.id, {
			title: 'Eigen test',
			body: 'Push notifications are working for this device.',
			url: '/settings',
			tag: 'eigen-test'
		});
		return json({ ok: true as const, ...result });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes('VAPID_') || msg.includes('VAPID')) {
			error(503, msg);
		}
		if (msg.includes('No push subscriptions')) {
			error(400, msg);
		}
		error(500, msg);
	}
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	assertDeleteAllMemoriesConfirmation,
	deleteAllMemoriesForUser
} from '$lib/server/memory/delete-all-memories';

export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Expected JSON body');
	}
	if (!body || typeof body !== 'object') error(400, 'Expected JSON object');

	const confirmation =
		'confirmation' in body && typeof (body as { confirmation?: unknown }).confirmation === 'string'
			? (body as { confirmation: string }).confirmation
			: '';

	try {
		assertDeleteAllMemoriesConfirmation(confirmation);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		error(400, msg);
	}

	try {
		const result = await deleteAllMemoriesForUser(user.id);
		return json({ ok: true as const, ...result });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		error(500, msg);
	}
};

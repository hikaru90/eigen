import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { userApiKey } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { id } = event.params;

	const db = getDb();
	const [existing] = await db
		.select({ id: userApiKey.id })
		.from(userApiKey)
		.where(and(eq(userApiKey.id, id), eq(userApiKey.userId, user.id)))
		.limit(1);

	if (!existing) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	await db
		.update(userApiKey)
		.set({ isActive: false })
		.where(eq(userApiKey.id, id));

	return json({ ok: true });
};

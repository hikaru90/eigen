import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { userApiKey } from '$lib/server/db/schema';
import { generateApiKey } from '$lib/server/api-keys/api-key-utils';
import { eq, and } from 'drizzle-orm';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await event.request.json().catch(() => ({}));
	const name = typeof body.name === 'string' && body.name.trim().length > 0
		? body.name.trim()
		: 'default';

	const { raw, prefix, hash } = generateApiKey();

	const db = getDb();
	const [inserted] = await db
		.insert(userApiKey)
		.values({
			userId: user.id,
			name,
			keyPrefix: prefix,
			keyHash: hash
		})
		.returning({ id: userApiKey.id });

	return json({ key: raw, prefix, name, id: inserted.id }, { status: 201 });
};

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const db = getDb();
	const keys = await db
		.select({
			id: userApiKey.id,
			name: userApiKey.name,
			keyPrefix: userApiKey.keyPrefix,
			isActive: userApiKey.isActive,
			lastUsedAt: userApiKey.lastUsedAt,
			createdAt: userApiKey.createdAt
		})
		.from(userApiKey)
		.where(and(eq(userApiKey.userId, user.id), eq(userApiKey.isActive, true)))
		.orderBy(userApiKey.createdAt);

	return json({ keys });
};

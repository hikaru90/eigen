import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eq, and } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userApiKey } from '$lib/server/db/schema';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
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
		.where(and(eq(userApiKey.userId, event.locals.user.id), eq(userApiKey.isActive, true)))
		.orderBy(userApiKey.createdAt);

	return {
		user: event.locals.user,
		keys
	};
};

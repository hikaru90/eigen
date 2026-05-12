import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { chatSession, chatMessage } from '$lib/server/db/brain.schema';
import { desc, eq, sql } from 'drizzle-orm';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const db = getDb();
	const rows = await db
		.select({
			id: chatSession.id,
			title: chatSession.title,
			createdAt: chatSession.createdAt,
			updatedAt: chatSession.updatedAt,
			messageCount: sql<number>`count(${chatMessage.id})::int`
		})
		.from(chatSession)
		.leftJoin(chatMessage, eq(chatMessage.sessionId, chatSession.id))
		.where(eq(chatSession.userId, user.id))
		.groupBy(chatSession.id)
		.orderBy(desc(chatSession.updatedAt))
		.limit(50);

	return json({ sessions: rows });
};

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const db = getDb();
	const [session] = await db
		.insert(chatSession)
		.values({ userId: user.id })
		.returning({ id: chatSession.id, title: chatSession.title });

	return json({ session });
};

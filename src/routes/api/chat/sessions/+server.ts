import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { chatSession, chatMessage } from '$lib/server/db/brain.schema';
import { desc, eq, sql } from 'drizzle-orm';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const db = getDb();

	// Get first user message preview for sessions without titles
	const firstMessages = db.$with('first_messages').as(
		db
			.select({
				sessionId: chatMessage.sessionId,
				content: chatMessage.content
			})
			.from(chatMessage)
			.where(eq(chatMessage.role, 'user'))
			.orderBy(chatMessage.createdAt)
			.limit(1)
	);

	const rows = await db
		.with(firstMessages)
		.select({
			id: chatSession.id,
			title: chatSession.title,
			createdAt: chatSession.createdAt,
			updatedAt: chatSession.updatedAt,
			messageCount: sql<number>`count(${chatMessage.id})::int`,
			firstMessagePreview: sql<string>`max(case when ${chatMessage.role} = 'user' then ${chatMessage.content} end)`
		})
		.from(chatSession)
		.leftJoin(chatMessage, eq(chatMessage.sessionId, chatSession.id))
		.where(eq(chatSession.userId, user.id))
		.groupBy(chatSession.id)
		.orderBy(desc(chatSession.updatedAt))
		.limit(50);

	// Transform to include computed title if empty
	const sessions = rows.map(row => ({
		...row,
		title: row.title?.trim() || (row.firstMessagePreview
			? (row.firstMessagePreview.length > 50
				? row.firstMessagePreview.slice(0, 47) + '...'
				: row.firstMessagePreview)
			: '')
	}));

	return json({ sessions });
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

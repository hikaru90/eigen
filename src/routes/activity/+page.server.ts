import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { desc, eq } from 'drizzle-orm';
import { activityCallLog } from '$lib/server/db/schema';
import { getDb } from '$lib/server/db';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}
	const rows = await getDb()
		.select()
		.from(activityCallLog)
		.where(eq(activityCallLog.userId, event.locals.user.id))
		.orderBy(desc(activityCallLog.createdAt))
		.limit(100);
	return { user: event.locals.user, calls: rows };
};

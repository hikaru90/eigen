/**
 * POST /api/admin/dispatch-reminders
 *
 * Fire due event reminder and daily summary push notifications. Authenticated with X-Admin-Key
 * (same pattern as consolidation). Scheduled via pg_cron → pg_net
 * (see scripts/ensure-reminder-cron.mjs).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { dispatchDueDailySummaries } from '$lib/server/memory/daily-summary-dispatch';
import { dispatchDueEventReminders } from '$lib/server/memory/event-reminder-dispatch';

function getAdminKey(): string | undefined {
	return env.ADMIN_CONSOLIDATION_KEY?.trim() || undefined;
}

export const POST: RequestHandler = async (event) => {
	const adminKey = event.request.headers.get('x-admin-key')?.trim();
	const configuredAdminKey = getAdminKey();

	if (!configuredAdminKey || adminKey !== configuredAdminKey) {
		error(401, 'Unauthorized');
	}

	const startedAt = Date.now();
	const [eventReminders, dailySummaries] = await Promise.all([
		dispatchDueEventReminders(),
		dispatchDueDailySummaries()
	]);

	console.info('[dispatch-reminders] completed', {
		durationMs: Date.now() - startedAt,
		eventReminders,
		dailySummaries
	});

	return json({ ok: true, eventReminders, dailySummaries });
};

/**
 * GET /api/admin/ops-health
 *
 * Operator snapshot for job queue, push notifications, pg_cron, and recent pg_net HTTP results.
 * Authenticated with X-Admin-Key (same as consolidation / reminder dispatch).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { loadOpsHealthSnapshot } from '$lib/server/ops/health-snapshot';

function getAdminKey(): string | undefined {
	return env.ADMIN_CONSOLIDATION_KEY?.trim() || undefined;
}

export const GET: RequestHandler = async (event) => {
	const adminKey = event.request.headers.get('x-admin-key')?.trim();
	const configuredAdminKey = getAdminKey();

	if (!configuredAdminKey || adminKey !== configuredAdminKey) {
		error(401, 'Unauthorized');
	}

	const snapshot = await loadOpsHealthSnapshot();
	return json({ ok: true, ...snapshot });
};

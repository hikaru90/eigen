/**
 * POST /api/admin/consolidate
 *
 * Trigger the consolidation pipeline for one user or all users.
 * Authenticated with an admin API key (X-Admin-Key header) or a valid user
 * session — admin key allows running for any/all users, session restricts
 * to the authenticated user only.
 *
 * Request body (JSON, optional):
 *   { userId?: string }  — omit to run for all users (admin key required)
 *
 * This endpoint is designed to be called by an external cron scheduler
 * (e.g. cron-job.org, Render cron, GitHub Actions schedule).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { consolidateForUser, consolidateAllUsers } from '$lib/server/consolidation/runner';

function getAdminKey(): string | undefined {
	return env.ADMIN_CONSOLIDATION_KEY?.trim() || undefined;
}

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	const adminKey = event.request.headers.get('x-admin-key')?.trim();
	const configuredAdminKey = getAdminKey();

	const isAdminKeyValid = configuredAdminKey && adminKey === configuredAdminKey;
	const isAuthenticated = !!user;

	if (!isAdminKeyValid && !isAuthenticated) {
		error(401, 'Unauthorized');
	}

	let body: { userId?: string } = {};
	try {
		const raw = await event.request.text();
		if (raw.trim()) body = JSON.parse(raw);
	} catch {
		// Body is optional; empty body means "run for all" (admin) or "run for me" (user).
	}

	const targetUserId = body.userId ?? (isAdminKeyValid ? undefined : user?.id);

	try {
		if (targetUserId) {
			// Restrict non-admin users to their own data.
			if (!isAdminKeyValid && user?.id !== targetUserId) {
				error(403, 'Forbidden');
			}
			const result = await consolidateForUser(targetUserId);
			return json({ ok: true, results: [result] });
		} else {
			// All users — requires admin key.
			if (!isAdminKeyValid) {
				error(403, 'Admin key required to run consolidation for all users');
			}
			const results = await consolidateAllUsers();
			return json({ ok: true, results });
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[consolidate] endpoint error', {
			message: err instanceof Error ? err.message : String(err)
		});
		return json(
			{
				ok: false,
				error: err instanceof Error ? err.message : 'Consolidation failed'
			},
			{ status: 500 }
		);
	}
};

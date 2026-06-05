/**
 * POST /api/admin/reenrich
 *
 * Re-runs full async enrichment for thoughts that have not yet been enriched
 * (enriched_at IS NULL). Processes up to `limit` thoughts per call (default 50).
 *
 * Authenticated via admin API key (X-Admin-Key) or valid user session.
 * Session auth restricts to the authenticated user's thoughts only.
 *
 * Request body (optional JSON):
 *   { userId?: string, limit?: number }
 *
 * Returns: { ok, enqueued, userIds }
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { isNull, eq, and } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { scheduleEnrichThought } from '$lib/server/capture/enrich';

function getAdminKey(): string | undefined {
	return env.ADMIN_CONSOLIDATION_KEY?.trim() || undefined;
}

export const POST: RequestHandler = async (event) => {
	const sessionUser = event.locals.user;
	const adminKey = event.request.headers.get('x-admin-key')?.trim();
	const configuredAdminKey = getAdminKey();

	const isAdminKeyValid = configuredAdminKey && adminKey === configuredAdminKey;
	const isAuthenticated = !!sessionUser;

	if (!isAdminKeyValid && !isAuthenticated) {
		error(401, 'Unauthorized');
	}

	let body: { userId?: string; limit?: number } = {};
	try {
		const raw = await event.request.text();
		if (raw.trim()) body = JSON.parse(raw) as typeof body;
	} catch {
		// Body optional.
	}

	const targetUserId = body.userId ?? sessionUser?.id;
	if (!targetUserId && !isAdminKeyValid) {
		error(400, 'userId required');
	}

	if (targetUserId && !isAdminKeyValid && sessionUser?.id !== targetUserId) {
		error(403, 'Forbidden');
	}

	const limit = Math.max(1, Math.min(body.limit ?? 50, 500));
	const db = getDb();

	// Find thoughts missing enrichment.
	const whereClause = targetUserId
		? and(eq(thought.userId, targetUserId), isNull(thought.enrichedAt))
		: isNull(thought.enrichedAt);

	const pending = await db
		.select({
			id: thought.id,
			userId: thought.userId,
			normalizedText: thought.normalizedText
		})
		.from(thought)
		.where(whereClause)
		.limit(limit);

	if (pending.length === 0) {
		return json({ ok: true, enqueued: 0, message: 'No unenriched thoughts found.' });
	}

	// Fire enrichment for each thought (intentionally sequential to avoid
	// overwhelming the LLM gateway with concurrent calls).
	let enqueued = 0;
	for (const t of pending) {
		scheduleEnrichThought(t.userId, t.id, t.normalizedText);
		enqueued++;
	}

	const userIds = [...new Set(pending.map((t) => t.userId))];
	return json({ ok: true, enqueued, userIds });
};

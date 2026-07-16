import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getDb } from '$lib/server/db';
import { pushSubscription } from '$lib/server/db/schema';
import { createAdminSql } from '$lib/server/job-queue/admin-db';

export type PushSubscriptionInput = {
	endpoint: string;
	keys: {
		p256dh: string;
		auth: string;
	};
};

/** Safe to show in UI — never includes SQL / Drizzle dump text. */
export const PUSH_SUBSCRIBE_USER_ERROR =
	'Could not save notification settings for this device. Try again, or enable later in Settings.';

export function parsePushSubscriptionBody(body: unknown): PushSubscriptionInput {
	if (!body || typeof body !== 'object') {
		throw new Error('Expected JSON object');
	}
	const o = body as Record<string, unknown>;
	const endpoint = typeof o.endpoint === 'string' ? o.endpoint.trim() : '';
	if (!endpoint) throw new Error('endpoint is required');
	if (/\s/.test(endpoint)) throw new Error('endpoint must not contain whitespace');

	const keysRaw = o.keys;
	if (!keysRaw || typeof keysRaw !== 'object') {
		throw new Error('keys object with p256dh and auth is required');
	}
	const keys = keysRaw as Record<string, unknown>;
	const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : '';
	const auth = typeof keys.auth === 'string' ? keys.auth.trim() : '';
	if (!p256dh) throw new Error('keys.p256dh is required');
	if (!auth) throw new Error('keys.auth is required');

	return { endpoint, keys: { p256dh, auth } };
}

export function isPushSubscriptionInfrastructureError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
	const causeMsg = cause instanceof Error ? cause.message : cause != null ? String(cause) : '';
	const combined = `${msg}\n${causeMsg}`;
	return (
		combined.includes('Failed query:') ||
		combined.includes('push_subscription') ||
		combined.includes('row-level security') ||
		combined.includes('duplicate key') ||
		combined.includes('unique_violation') ||
		/\b23505\b/.test(combined) ||
		/\b42501\b/.test(combined)
	);
}

async function upsertPushSubscriptionRow(
	db: ReturnType<typeof getDb>,
	userId: string,
	input: PushSubscriptionInput,
	userAgent: string | null
): Promise<{ id: string }> {
	const [row] = await db
		.insert(pushSubscription)
		.values({
			userId,
			endpoint: input.endpoint,
			p256dh: input.keys.p256dh,
			auth: input.keys.auth,
			userAgent
		})
		.onConflictDoUpdate({
			target: pushSubscription.endpoint,
			set: {
				userId,
				p256dh: input.keys.p256dh,
				auth: input.keys.auth,
				userAgent,
				updatedAt: new Date()
			}
		})
		.returning({ id: pushSubscription.id });
	if (!row) throw new Error('Failed to persist push subscription');
	return row;
}

/**
 * Endpoint is globally unique. If another account already owns this browser endpoint,
 * tenant RLS blocks ON CONFLICT UPDATE — clear via admin and insert for the current user.
 */
async function reassignEndpointToUser(
	userId: string,
	input: PushSubscriptionInput,
	userAgent: string | null
): Promise<{ id: string }> {
	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { pushSubscription } });
		await db.delete(pushSubscription).where(eq(pushSubscription.endpoint, input.endpoint));
		const [row] = await db
			.insert(pushSubscription)
			.values({
				userId,
				endpoint: input.endpoint,
				p256dh: input.keys.p256dh,
				auth: input.keys.auth,
				userAgent
			})
			.onConflictDoUpdate({
				target: pushSubscription.endpoint,
				set: {
					userId,
					p256dh: input.keys.p256dh,
					auth: input.keys.auth,
					userAgent,
					updatedAt: new Date()
				}
			})
			.returning({ id: pushSubscription.id });
		if (!row) throw new Error(PUSH_SUBSCRIBE_USER_ERROR);
		return row;
	} finally {
		await sql.end();
	}
}

export async function upsertPushSubscription(
	userId: string,
	input: PushSubscriptionInput,
	userAgent: string | null
): Promise<{ id: string }> {
	try {
		return await upsertPushSubscriptionRow(getDb(), userId, input, userAgent);
	} catch (err) {
		if (!isPushSubscriptionInfrastructureError(err)) throw err;
		console.warn('[push] tenant upsert failed; reassigning endpoint', {
			userId,
			message: err instanceof Error ? err.message : String(err)
		});
		try {
			return await reassignEndpointToUser(userId, input, userAgent);
		} catch (reassignErr) {
			console.error('[push] endpoint reassign failed', {
				userId,
				message: reassignErr instanceof Error ? reassignErr.message : String(reassignErr)
			});
			throw new Error(PUSH_SUBSCRIBE_USER_ERROR);
		}
	}
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
	const trimmed = endpoint.trim();
	if (!trimmed) throw new Error('endpoint is required');
	const db = getDb();
	const deleted = await db
		.delete(pushSubscription)
		.where(eq(pushSubscription.endpoint, trimmed))
		.returning({ id: pushSubscription.id });
	return deleted.length > 0;
}

export async function listPushSubscriptionsForUser(userId: string) {
	return getDb().select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
}

export async function deletePushSubscriptionById(id: string): Promise<void> {
	await getDb().delete(pushSubscription).where(eq(pushSubscription.id, id));
}

import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { pushSubscription } from '$lib/server/db/schema';

export type PushSubscriptionInput = {
	endpoint: string;
	keys: {
		p256dh: string;
		auth: string;
	};
};

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

export async function upsertPushSubscription(
	userId: string,
	input: PushSubscriptionInput,
	userAgent: string | null
): Promise<{ id: string }> {
	const db = getDb();
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

import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { tenantDataKey } from '$lib/server/db/schema';
import { getKekKeyId, getKekProvider, unwrapDek, wrapDek } from '$lib/server/crypto/kms';

const dekCache = new Map<string, { key: Buffer; expiresAt: number }>();
const DEK_CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(userId: string, version: number): string {
	return `${userId}:${version}`;
}

export async function getOrCreateTenantDek(userId: string): Promise<{ dek: Buffer; version: number }> {
	const [row] = await getDb()
		.select()
		.from(tenantDataKey)
		.where(eq(tenantDataKey.userId, userId))
		.limit(1);

	if (!row) {
		const dek = randomBytes(32);
		const wrapped = await wrapDek({ userId, dekBytes: dek });
		const version = 1;
		await getDb().insert(tenantDataKey).values({
			userId,
			wrappedDek: wrapped,
			dekVersion: version,
			kekProvider: getKekProvider(),
			kekKeyId: getKekKeyId()
		});
		dekCache.set(cacheKey(userId, version), { key: dek, expiresAt: Date.now() + DEK_CACHE_TTL_MS });
		return { dek, version };
	}

	const version = row.dekVersion;
	const ckey = cacheKey(userId, version);
	const cached = dekCache.get(ckey);
	if (cached && cached.expiresAt > Date.now()) {
		return { dek: cached.key, version };
	}
	const dek = await unwrapDek({ userId, wrappedDek: row.wrappedDek });
	dekCache.set(ckey, { key: dek, expiresAt: Date.now() + DEK_CACHE_TTL_MS });
	return { dek, version };
}

export async function rotateTenantDek(userId: string): Promise<{ previousVersion: number; newVersion: number }> {
	const [row] = await getDb()
		.select()
		.from(tenantDataKey)
		.where(eq(tenantDataKey.userId, userId))
		.limit(1);
	if (!row) {
		await getOrCreateTenantDek(userId);
		return { previousVersion: 0, newVersion: 1 };
	}
	const newDek = randomBytes(32);
	const wrapped = await wrapDek({ userId, dekBytes: newDek });
	const newVersion = row.dekVersion + 1;
	await getDb()
		.update(tenantDataKey)
		.set({
			wrappedDek: wrapped,
			dekVersion: newVersion,
			kekProvider: getKekProvider(),
			kekKeyId: getKekKeyId(),
			updatedAt: new Date()
		})
		.where(and(eq(tenantDataKey.userId, userId), eq(tenantDataKey.dekVersion, row.dekVersion)));
	dekCache.set(cacheKey(userId, newVersion), {
		key: newDek,
		expiresAt: Date.now() + DEK_CACHE_TTL_MS
	});
	return { previousVersion: row.dekVersion, newVersion };
}

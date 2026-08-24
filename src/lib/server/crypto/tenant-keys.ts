import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getKekKeyId, getKekProvider, unwrapDek, wrapDek } from '$lib/server/crypto/kms'
import { getDb } from '$lib/server/db'
import { tenantDataKey } from '$lib/server/db/schema'

const dekCache = new Map<string, { key: Buffer; expiresAt: number }>()
const DEK_CACHE_TTL_MS = 5 * 60 * 1000
/** Serialize first-time DEK creation per user (capture encrypts several columns in parallel). */
const pendingCreates = new Map<string, Promise<{ dek: Buffer; version: number }>>()

function cacheKey(userId: string, version: number): string {
  return `${userId}:${version}`
}

type TenantDekRow = typeof tenantDataKey.$inferSelect

async function loadTenantDekFromRow(
  userId: string,
  row: TenantDekRow,
): Promise<{ dek: Buffer; version: number }> {
  const version = row.dekVersion
  const ckey = cacheKey(userId, version)
  const cached = dekCache.get(ckey)
  if (cached && cached.expiresAt > Date.now()) {
    return { dek: cached.key, version }
  }
  const dek = await unwrapDek({ userId, wrappedDek: row.wrappedDek })
  dekCache.set(ckey, { key: dek, expiresAt: Date.now() + DEK_CACHE_TTL_MS })
  return { dek, version }
}

async function getOrCreateTenantDekInner(
  userId: string,
): Promise<{ dek: Buffer; version: number }> {
  const [row] = await getDb()
    .select()
    .from(tenantDataKey)
    .where(eq(tenantDataKey.userId, userId))
    .limit(1)

  if (row) {
    return loadTenantDekFromRow(userId, row)
  }

  const dek = randomBytes(32)
  const wrapped = await wrapDek({ userId, dekBytes: dek })
  const version = 1
  await getDb()
    .insert(tenantDataKey)
    .values({
      userId,
      wrappedDek: wrapped,
      dekVersion: version,
      kekProvider: getKekProvider(),
      kekKeyId: getKekKeyId(),
    })
    .onConflictDoNothing()

  const [inserted] = await getDb()
    .select()
    .from(tenantDataKey)
    .where(eq(tenantDataKey.userId, userId))
    .limit(1)
  if (!inserted) {
    throw new Error(`tenant_data_key row missing after insert for user ${userId}`)
  }
  return loadTenantDekFromRow(userId, inserted)
}

export async function getOrCreateTenantDek(
  userId: string,
): Promise<{ dek: Buffer; version: number }> {
  let pending = pendingCreates.get(userId)
  if (!pending) {
    pending = getOrCreateTenantDekInner(userId)
    pendingCreates.set(userId, pending)
    void pending.finally(() => {
      if (pendingCreates.get(userId) === pending) {
        pendingCreates.delete(userId)
      }
    })
  }
  return pending
}

export async function rotateTenantDek(
  userId: string,
): Promise<{ previousVersion: number; newVersion: number }> {
  const [row] = await getDb()
    .select()
    .from(tenantDataKey)
    .where(eq(tenantDataKey.userId, userId))
    .limit(1)
  if (!row) {
    await getOrCreateTenantDek(userId)
    return { previousVersion: 0, newVersion: 1 }
  }
  const newDek = randomBytes(32)
  const wrapped = await wrapDek({ userId, dekBytes: newDek })
  const newVersion = row.dekVersion + 1
  await getDb()
    .update(tenantDataKey)
    .set({
      wrappedDek: wrapped,
      dekVersion: newVersion,
      kekProvider: getKekProvider(),
      kekKeyId: getKekKeyId(),
      updatedAt: new Date(),
    })
    .where(and(eq(tenantDataKey.userId, userId), eq(tenantDataKey.dekVersion, row.dekVersion)))
  dekCache.set(cacheKey(userId, newVersion), {
    key: newDek,
    expiresAt: Date.now() + DEK_CACHE_TTL_MS,
  })
  return { previousVersion: row.dekVersion, newVersion }
}

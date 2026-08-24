import postgres from 'postgres'
import { env } from '$env/dynamic/private'
import { getRuntimeDatabaseUrl } from '$lib/server/db/runtime-url'

function normalizePostgresUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.searchParams.delete('uselibpqcompat')
    return url.toString()
  } catch {
    return raw
  }
}

/** Admin/superuser pool URL — reads SvelteKit private env, not raw process.env. */
export function getAdminDatabaseUrl(): string {
  const admin = env.DATABASE_ADMIN_URL?.trim()
  if (admin) return normalizePostgresUrl(admin)
  return getRuntimeDatabaseUrl()
}

export function createAdminSql(max = 2) {
  return postgres(getAdminDatabaseUrl(), { max })
}

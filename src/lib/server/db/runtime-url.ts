import { env } from '$lib/server/env/private-env'

/** Normalized Postgres URL for app and auth pools (drops drizzle-kit-only query flags). */
export function getRuntimeDatabaseUrl(): string {
  const raw = env.DATABASE_URL
  if (!raw) throw new Error('DATABASE_URL is not set')
  try {
    const url = new URL(raw)
    url.searchParams.delete('uselibpqcompat')
    return url.toString()
  } catch {
    return raw
  }
}

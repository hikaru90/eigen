/** Normalized Postgres URL from DATABASE_URL (drops drizzle-kit-only query flags). */
export function getDatabaseUrl() {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error('DATABASE_URL is required')
  }
  try {
    const u = new URL(raw)
    u.searchParams.delete('uselibpqcompat')
    return u.toString()
  } catch {
    return raw
  }
}

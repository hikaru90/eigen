import { eq } from 'drizzle-orm'
import { authDb } from '$lib/server/db/auth-db'
import { user } from '$lib/server/db/auth.schema'

/** `maker`: Contribute board over MCP, no /admin. `admin`: both. */
export type UserRole = 'user' | 'maker' | 'admin'

export async function getUserRole(userId: string): Promise<UserRole> {
  const [row] = await authDb
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return row?.role === 'admin' || row?.role === 'maker' ? row.role : 'user'
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  return (await getUserRole(userId)) === 'admin'
}

/** Board MCP tools are for the makers' own agents — normal users' agents never see them. */
export async function hasBoardMcpAccess(userId: string): Promise<boolean> {
  return (await getUserRole(userId)) !== 'user'
}

export async function grantAdminByEmail(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  const rows = await authDb
    .update(user)
    .set({ role: 'admin' })
    .where(eq(user.email, normalized))
    .returning({ id: user.id })
  return rows.length > 0
}

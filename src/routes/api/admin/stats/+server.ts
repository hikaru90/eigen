/**
 * GET /api/admin/stats
 *
 * Website admin dashboard: product user count.
 * Auth: X-Admin-Key (ADMIN_CONSOLIDATION_KEY).
 */

import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { countProductUsers } from '$lib/server/admin/users'
import { requireAdminKey } from '$lib/server/auth/admin-key'

export const GET: RequestHandler = async (event) => {
  requireAdminKey(event)
  const productUsers = await countProductUsers()
  return json({ productUsers })
}

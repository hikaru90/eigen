/**
 * GET /api/admin/users
 *
 * Website admin users list: paginated, searchable, sortable + totals.
 * Query: q, page, limit, sort, dir.
 * Auth: X-Admin-Key (ADMIN_CONSOLIDATION_KEY).
 */

import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import {
  listAdminUsers,
  parseAdminUsersDir,
  parseAdminUsersLimit,
  parseAdminUsersPage,
  parseAdminUsersSort,
} from '$lib/server/admin/users'
import { requireAdminKey } from '$lib/server/auth/admin-key'

export const GET: RequestHandler = async (event) => {
  requireAdminKey(event)

  const params = event.url.searchParams
  const result = await listAdminUsers({
    q: params.get('q')?.trim() || undefined,
    page: parseAdminUsersPage(params.get('page')),
    limit: parseAdminUsersLimit(params.get('limit')),
    sort: parseAdminUsersSort(params.get('sort')),
    dir: parseAdminUsersDir(params.get('dir')),
  })

  return json(result)
}

/**
 * GET /api/admin/users
 *
 * Website admin users list: paginated, searchable, sortable + totals.
 * Query: q, page, limit, sort, dir.
 * Auth: X-Admin-Key (ADMIN_CONSOLIDATION_KEY).
 */

import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { requireAdminKey } from '$lib/server/auth/admin-key'
import {
	listAdminUsers,
	parseAdminUsersDir,
	parseAdminUsersLimit,
	parseAdminUsersPage,
	parseAdminUsersSort,
} from '$lib/server/admin/users'

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

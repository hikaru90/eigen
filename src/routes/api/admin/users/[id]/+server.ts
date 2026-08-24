/**
 * GET /api/admin/users/:id
 *
 * Website admin user detail (ProductUserRow + tokensUsed + chatMessageCount).
 * Auth: X-Admin-Key (ADMIN_CONSOLIDATION_KEY).
 */

import type { RequestHandler } from './$types'
import { json, error } from '@sveltejs/kit'
import { getAdminUserDetail } from '$lib/server/admin/users'
import { requireAdminKey } from '$lib/server/auth/admin-key'

export const GET: RequestHandler = async (event) => {
	requireAdminKey(event)

	const user = await getAdminUserDetail(event.params.id)
	if (!user) {
		error(404, 'User not found')
	}

	return json({ user })
}

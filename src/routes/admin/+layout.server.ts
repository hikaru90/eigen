import type { LayoutServerLoad } from './$types'
import { requireAdmin } from '$lib/server/auth/require-admin'

export const load: LayoutServerLoad = async (event) => {
  await requireAdmin(event.locals.user)
  return {}
}

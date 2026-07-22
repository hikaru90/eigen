import { error, redirect } from '@sveltejs/kit'
import { isUserAdmin } from '$lib/server/auth/user-role'

export async function requireAdmin(
  user: App.Locals['user'],
): Promise<NonNullable<App.Locals['user']>> {
  if (!user) {
    throw redirect(302, '/login')
  }
  if (!(await isUserAdmin(user.id))) {
    error(403, 'Forbidden')
  }
  return user
}

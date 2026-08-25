import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async (event) => {
  const next = new URL('/admin/spend', event.url)
  next.searchParams.set('view', 'calls')
  next.searchParams.set('user', event.params.userId)
  throw redirect(302, next.pathname + next.search)
}

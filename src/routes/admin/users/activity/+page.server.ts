import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async (event) => {
  const q = event.url.searchParams.get('q')?.trim() ?? ''
  const next = new URL('/admin/spend', event.url)
  next.searchParams.set('view', 'calls')
  if (q) {
    next.searchParams.set('user', q)
  }
  throw redirect(302, next.pathname + next.search)
}

import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = (event) => {
  const target = new URL('/signup', event.url.origin)
  target.search = event.url.search
  throw redirect(302, `${target.pathname}${target.search}`)
}

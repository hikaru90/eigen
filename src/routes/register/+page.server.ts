import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = (event) => {
  const target = new URL('/signup', event.url.origin)
  target.search = event.url.search
  throw redirect(302, `${target.pathname}${target.search}`)
}

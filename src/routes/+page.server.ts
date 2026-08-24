import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = ({ locals }) => {
  throw redirect(302, locals.user ? '/capture' : '/login')
}

import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async (event) => {
  const qs = event.url.search
  throw redirect(302, `/memory/tasks${qs}`)
}

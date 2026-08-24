import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async (event) => {
  const qs = event.url.search
  throw redirect(302, `/memory/tasks${qs}`)
}

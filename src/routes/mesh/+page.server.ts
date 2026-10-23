import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

/** /mesh is the hub — it shows the Yarn journal (docs/planning/ei-redesign.md). */
export const load: PageServerLoad = async () => {
  throw redirect(302, '/mesh/yarn')
}

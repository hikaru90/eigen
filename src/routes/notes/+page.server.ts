import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async (event) => {
  const noteId = event.url.searchParams.get('note')
  const qs = noteId ? `?note=${encodeURIComponent(noteId)}` : ''
  throw redirect(302, `/memory/notes${qs}`)
}

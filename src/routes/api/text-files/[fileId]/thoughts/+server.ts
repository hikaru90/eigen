import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { listThoughtsForTextFile } from '$lib/server/text-files/service'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const fileId = event.params.fileId?.trim() ?? ''
  if (!fileId) error(400, 'fileId is required')

  const linkedThoughts = await listThoughtsForTextFile(user.id, fileId)
  return json({ linkedThoughts })
}

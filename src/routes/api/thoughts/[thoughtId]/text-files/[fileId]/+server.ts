import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { unlinkTextFileFromThought } from '$lib/server/text-files/service'

export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const thoughtId = event.params.thoughtId?.trim() ?? ''
  const fileId = event.params.fileId?.trim() ?? ''
  if (!thoughtId || !fileId) error(400, 'thoughtId and fileId are required')

  const unlinked = await unlinkTextFileFromThought(user.id, thoughtId, fileId)
  if (!unlinked) error(404, 'Attachment link not found')

  return json({ unlinked: true, thoughtId, textFileId: fileId })
}

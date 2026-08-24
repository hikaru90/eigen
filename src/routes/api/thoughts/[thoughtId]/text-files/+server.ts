import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { linkTextFileToThought, listTextFilesForThought } from '$lib/server/text-files/service'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const thoughtId = event.params.thoughtId?.trim() ?? ''
  if (!thoughtId) error(400, 'thoughtId is required')

  const attachedFiles = await listTextFilesForThought(user.id, thoughtId)
  return json({ attachedFiles })
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const thoughtId = event.params.thoughtId?.trim() ?? ''
  if (!thoughtId) error(400, 'thoughtId is required')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON')
  }

  const textFileId =
    typeof body === 'object' && body && 'textFileId' in body && typeof body.textFileId === 'string'
      ? body.textFileId.trim()
      : ''
  if (!textFileId) error(400, 'textFileId is required')

  const result = await linkTextFileToThought(user.id, thoughtId, textFileId)
  if (!result.linked) {
    if (result.reason === 'thought_not_found') error(404, 'Thought not found')
    error(404, 'Text file not found')
  }

  return json({ linked: true, thoughtId, textFileId })
}

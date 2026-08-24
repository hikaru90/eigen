import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { listThoughtsMentioningCanonicalEntity } from '$lib/server/memory/canonical-entity-admin'
import { listTextFilesForThoughtIds } from '$lib/server/text-files/service'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim() ?? ''
  if (!entityId) error(400, 'entityId is required')

  const rows = await listThoughtsMentioningCanonicalEntity(user.id, entityId)
  const attachedByThought = await listTextFilesForThoughtIds(
    user.id,
    rows.map((row) => row.id),
  )

  return json({
    thoughts: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      attachedFiles: attachedByThought.get(row.id) ?? [],
    })),
  })
}

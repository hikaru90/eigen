import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  deleteCanonicalEntityForUser,
  getCanonicalEntityForUser,
  updateCanonicalEntityForUser,
} from '$lib/server/memory/canonical-entity-admin'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim() ?? ''
  if (!entityId) error(400, 'entityId is required')

  const row = await getCanonicalEntityForUser(user.id, entityId)
  if (!row) error(404, 'Entity not found')

  return json(row)
}

export const PATCH: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim() ?? ''
  if (!entityId) error(400, 'entityId is required')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Expected JSON body')
  }
  if (!body || typeof body !== 'object') error(400, 'Expected JSON object')

  const label =
    'label' in body && typeof (body as { label?: unknown }).label === 'string'
      ? (body as { label: string }).label
      : undefined
  const entityType =
    'entityType' in body && typeof (body as { entityType?: unknown }).entityType === 'string'
      ? (body as { entityType: string }).entityType
      : undefined

  if (label === undefined && entityType === undefined) {
    error(400, 'Provide at least one of label, entityType')
  }

  try {
    const result = await updateCanonicalEntityForUser(user.id, entityId, { label, entityType })
    if (!result.ok) error(404, 'Entity not found')
    return json({ entity: result.entity })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('non-empty')) error(400, msg)
    throw e
  }
}

export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim() ?? ''
  if (!entityId) error(400, 'entityId is required')

  const result = await deleteCanonicalEntityForUser(user.id, entityId)
  if (!result.ok) error(404, 'Entity not found')

  return json({ ok: true as const })
}

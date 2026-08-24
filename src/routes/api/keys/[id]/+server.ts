import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { eq, and } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { userApiKey } from '$lib/server/db/schema'
import { jsonError } from '$lib/server/http/api-error'

export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) {
    return jsonError('Unauthorized', 401)
  }

  const { id } = event.params

  const db = getDb()
  const [existing] = await db
    .select({ id: userApiKey.id })
    .from(userApiKey)
    .where(and(eq(userApiKey.id, id), eq(userApiKey.userId, user.id)))
    .limit(1)

  if (!existing) {
    return jsonError('Not found', 404)
  }

  await db.update(userApiKey).set({ isActive: false }).where(eq(userApiKey.id, id))

  return json({ ok: true })
}

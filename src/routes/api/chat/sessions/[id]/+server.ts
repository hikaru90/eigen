import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import { loadChatSession } from '$lib/server/chat/chat-sessions'
import { getDb } from '$lib/server/db'
import { chatSession, chatMessage } from '$lib/server/db/brain.schema'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')
  const loaded = await loadChatSession(event.params.id)
  if (!loaded) error(404, 'Session not found')
  return json(loaded)
}

export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const sessionId = event.params.id
  const db = getDb()

  const [existing] = await db
    .select({ id: chatSession.id })
    .from(chatSession)
    .where(eq(chatSession.id, sessionId))
    .limit(1)

  if (!existing) error(404, 'Session not found')

  await db.delete(chatMessage).where(eq(chatMessage.sessionId, sessionId))
  await db.delete(chatSession).where(eq(chatSession.id, sessionId))

  return json({ deleted: true })
}

import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { eq, asc } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { chatSession, chatMessage } from '$lib/server/db/brain.schema'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const sessionId = event.params.id
  const db = getDb()

  const [session] = await db
    .select({ id: chatSession.id, title: chatSession.title })
    .from(chatSession)
    .where(eq(chatSession.id, sessionId))
    .limit(1)

  if (!session) error(404, 'Session not found')

  const messages = await db
    .select({
      id: chatMessage.id,
      role: chatMessage.role,
      content: chatMessage.content,
      metadata: chatMessage.metadata,
      createdAt: chatMessage.createdAt,
    })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, sessionId))
    .orderBy(asc(chatMessage.createdAt))

  return json({ session, messages })
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

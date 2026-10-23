import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { listChatSessions } from '$lib/server/chat/chat-sessions'
import { getDb } from '$lib/server/db'
import { chatSession } from '$lib/server/db/brain.schema'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')
  return json({ sessions: await listChatSessions(user.id) })
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const db = getDb()
  const [session] = await db
    .insert(chatSession)
    .values({ userId: user.id })
    .returning({ id: chatSession.id, title: chatSession.title })

  return json({ session })
}

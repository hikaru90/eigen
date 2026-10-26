import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { chatMessage, chatSession } from '$lib/server/db/brain.schema'
import { resolveSecureReferences } from '$lib/server/facts/secure-values'

/** Ask's session list: newest first, untitled sessions named after their first question. */
export async function listChatSessions(userId: string) {
  const rows = await getDb()
    .select({
      id: chatSession.id,
      title: chatSession.title,
      mode: chatSession.mode,
      createdAt: chatSession.createdAt,
      updatedAt: chatSession.updatedAt,
      messageCount: sql<number>`count(${chatMessage.id})::int`,
      firstMessagePreview: sql<string>`max(case when ${chatMessage.role} = 'user' then ${chatMessage.content} end)`,
    })
    .from(chatSession)
    .leftJoin(chatMessage, eq(chatMessage.sessionId, chatSession.id))
    .where(and(eq(chatSession.userId, userId), eq(chatSession.mode, 'default')))
    .groupBy(chatSession.id)
    .orderBy(desc(chatSession.updatedAt))
    .limit(50)

  return rows.map(({ firstMessagePreview, ...row }) => ({
    ...row,
    title:
      row.title?.trim() ||
      (firstMessagePreview
        ? firstMessagePreview.length > 50
          ? firstMessagePreview.slice(0, 47) + '...'
          : firstMessagePreview
        : ''),
  }))
}

export type ChatSessionListRow = Awaited<ReturnType<typeof listChatSessions>>[number]

/**
 * One session and its messages in order, or null when it does not exist (for this tenant), as the
 * user sees it: the assistant's stored answers show a secure value where they hold its reference
 * (an identifier the user asked for). The rows keep the token, and the next turn's model reads it.
 */
export async function loadChatSession(sessionId: string, userId: string) {
  const db = getDb()
  const [session] = await db
    .select({ id: chatSession.id, title: chatSession.title })
    .from(chatSession)
    .where(eq(chatSession.id, sessionId))
    .limit(1)
  if (!session) return null

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

  // metadata is a jsonb object column; drizzle types it as unknown.
  return {
    session,
    messages: await Promise.all(
      messages.map(async (m) => {
        const metadata = m.metadata as Record<string, unknown> | null
        // a final answer is an assistant row without a step variant (tool calls, thinking, errors)
        const isAnswer = m.role === 'assistant' && !metadata?.variant
        return {
          ...m,
          metadata,
          content: isAnswer ? await resolveSecureReferences(userId, m.content) : m.content,
        }
      }),
    ),
  }
}

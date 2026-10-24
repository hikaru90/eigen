import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { withDbUser } from '$lib/server/db'
import { userNotification } from '$lib/server/db/schema'

/** What kind of news a notification carries (drives nothing but analytics and copy). */
export type NotificationKind = 'idea_shipped'

export type NotificationRow = {
  id: string
  kind: string
  title: string
  body: string
  href: string | null
  createdAt: string
  readAt: string | null
}

/** Writes one notification for `userId` under that user's RLS session. */
export async function createNotification(
  userId: string,
  input: { kind: NotificationKind; title: string; body: string; href: string | null },
): Promise<void> {
  await withDbUser(userId, (db) => db.insert(userNotification).values({ userId, ...input }))
}

/** The user's notifications, newest first. */
export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
  const rows = await withDbUser(userId, (db) =>
    db
      .select()
      .from(userNotification)
      .where(eq(userNotification.userId, userId))
      .orderBy(desc(userNotification.createdAt))
      .limit(limit),
  )
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  }))
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const [row] = await withDbUser(userId, (db) =>
    db
      .select({ n: count() })
      .from(userNotification)
      .where(and(eq(userNotification.userId, userId), isNull(userNotification.readAt))),
  )
  return Number(row?.n ?? 0)
}

/** Marks every unread notification read (opening the list reads them). */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  await withDbUser(userId, (db) =>
    db
      .update(userNotification)
      .set({ readAt: new Date() })
      .where(and(eq(userNotification.userId, userId), isNull(userNotification.readAt))),
  )
}

import { and, count, eq, inArray, ne } from 'drizzle-orm'
import type { CreditMeter } from '$lib/billing/credit-meter'
import { loadCreditMeter } from '$lib/server/billing/wallet'
import { getDb } from '$lib/server/db'
import { canonicalEntity, thought, userApiKey } from '$lib/server/db/schema'
import { loadGroundingProfileRow } from '$lib/server/grounding/profile'
import { countUnreadNotifications } from '$lib/server/notifications/service'

/** The You menu's enumeration (ei `.me-head small`, `.me-meta`): read-only, tenant-scoped. */
export type YouCounts = {
  /** Thoughts not archived (open + completed). */
  thoughts: number
  /** Threads = GTD projects that are still running (active + someday). */
  threads: number
  /** Active API keys. */
  apiKeys: number
  /** The usage bar; null until the user has a wallet. */
  credits: CreditMeter | null
  /** Unread in-app notifications plus a pending check-in question (You menu → Notifications). */
  notificationsUnread: number
}

export async function loadYouCounts(userId: string): Promise<YouCounts> {
  const db = getDb()
  const [[thoughts], [threads], [apiKeys], credits, unreadNotes, grounding] = await Promise.all([
    db
      .select({ n: count() })
      .from(thought)
      .where(and(eq(thought.userId, userId), ne(thought.lifecycleStatus, 'archived'))),
    db
      .select({ n: count() })
      .from(canonicalEntity)
      .where(
        and(
          eq(canonicalEntity.userId, userId),
          inArray(canonicalEntity.projectStatus, ['active', 'someday']),
        ),
      ),
    db
      .select({ n: count() })
      .from(userApiKey)
      .where(and(eq(userApiKey.userId, userId), eq(userApiKey.isActive, true))),
    loadCreditMeter(userId),
    countUnreadNotifications(userId),
    loadGroundingProfileRow(userId),
  ])
  const notificationsUnread = unreadNotes + (grounding?.pendingCheckIn ? 1 : 0)
  return {
    thoughts: Number(thoughts?.n ?? 0),
    threads: Number(threads?.n ?? 0),
    apiKeys: Number(apiKeys?.n ?? 0),
    credits,
    notificationsUnread,
  }
}

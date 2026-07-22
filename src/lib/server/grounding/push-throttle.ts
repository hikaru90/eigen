import { eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { userGroundingProfile } from '$lib/server/db/schema'
import { GROUNDING_PUSH_MIN_INTERVAL_MS } from '$lib/server/grounding/constants'
import type { CheckInQuestion } from '$lib/server/grounding/next-check-in'
import { loadGroundingProfileRow } from '$lib/server/grounding/profile'
import type { GroundingProfileSnapshot } from '$lib/server/grounding/types'

/**
 * Shared 24h throttle across onboarding welcome + milestone check-in pushes.
 * Null / missing lastGroundingPushAt means never sent → allowed.
 */
export function canSendGroundingPushToday(
  profile: Pick<GroundingProfileSnapshot, 'lastGroundingPushAt'> | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const last = profile?.lastGroundingPushAt
  if (!last) return true
  return nowMs - last.getTime() >= GROUNDING_PUSH_MIN_INTERVAL_MS
}

/**
 * After a successful grounding/check-in push: record the send time (24h cap) and
 * persist the question so notification taps can replay it. Does NOT bump
 * last_session_at — that stays deferred until answer/dismiss.
 */
export async function recordGroundingPushSent(
  userId: string,
  pendingQuestion: CheckInQuestion | null,
): Promise<void> {
  const now = new Date()
  const existing = await loadGroundingProfileRow(userId)
  const facets = existing?.facets ?? {}
  const sessionCount = existing?.sessionCount ?? 0

  await getDb()
    .insert(userGroundingProfile)
    .values({
      userId,
      facets,
      sessionCount,
      lastGroundingPushAt: now,
      pendingCheckIn: pendingQuestion as Record<string, unknown> | null,
    })
    .onConflictDoUpdate({
      target: userGroundingProfile.userId,
      set: {
        lastGroundingPushAt: now,
        pendingCheckIn: pendingQuestion as Record<string, unknown> | null,
        updatedAt: now,
      },
    })
}

/** Clear the persisted push question after the user answers or dismisses. */
export async function clearPendingCheckIn(userId: string): Promise<void> {
  const now = new Date()
  await getDb()
    .update(userGroundingProfile)
    .set({
      pendingCheckIn: null,
      updatedAt: now,
    })
    .where(eq(userGroundingProfile.userId, userId))
}

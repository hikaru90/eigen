import { eq } from 'drizzle-orm'
import { grantIdeaShippedReward, IDEA_SHIPPED_REWARD_CREDITS } from '$lib/server/billing/wallet'
import { getDb } from '$lib/server/db'
import { boardIdea } from '$lib/server/db/schema'
import { createNotification } from '$lib/server/notifications/service'
import { queueNotificationEmail } from '$lib/server/notify/notification-email'
import { sendPushToUser } from '$lib/server/push/send'
import { judgeIdeaReward } from './reward-judge'
import { listPushSubscriptionsForUser } from '$lib/server/push/subscription'

export type IdeaShippedReward = {
  authorUserId: string
  /** 0 when the judge declined (the author still hears it shipped). */
  credits: number
  /** The LLM judge's decision on whether this contribution earns the reward. */
  judge: { reward: boolean; reason: string }
  /** Push is reported, never hidden: credits, the in-app note and the email stand either way. */
  push: 'sent' | 'no_device' | 'failed'
}

/**
 * When an idea ships, its author is told — and, when the reward judge finds it a
 * genuine contribution, thanked with IDEA_SHIPPED_REWARD_CREDITS credits (once per
 * idea — the ledger enforces it): an in-app notification, a push and an email.
 * The judge is billed to the maker who ships it. Returns null when the author is
 * gone, or the idea had already been rewarded.
 */
export async function rewardShippedIdea(
  ideaId: string,
  makerUserId: string,
): Promise<IdeaShippedReward | null> {
  const [idea] = await getDb()
    .select({
      authorUserId: boardIdea.authorUserId,
      title: boardIdea.title,
      kind: boardIdea.kind,
      area: boardIdea.area,
      note: boardIdea.makerNote,
    })
    .from(boardIdea)
    .where(eq(boardIdea.id, ideaId))
    .limit(1)
  if (!idea) throw new Error(`rewardShippedIdea: idea ${ideaId} not found`)
  // the author deleted their account: there is no one left to thank
  const authorUserId = idea.authorUserId
  if (!authorUserId) return null

  const judge = await judgeIdeaReward({
    makerUserId,
    idea: { title: idea.title, kind: idea.kind, area: idea.area, note: idea.note },
  })
  let credits = 0
  if (judge.reward) {
    const { granted } = await grantIdeaShippedReward({ userId: authorUserId, ideaId })
    if (!granted) return null
    credits = IDEA_SHIPPED_REWARD_CREDITS
  }

  const title = 'Your idea shipped'
  const body =
    credits > 0
      ? `“${idea.title}” is live in Eigenmesh. Thank you — ${credits} credits are on your account.`
      : `“${idea.title}” is live in Eigenmesh. Thank you for sharing it.`
  const href = '/feedback'
  await createNotification(authorUserId, { kind: 'idea_shipped', title, body, href })
  await queueNotificationEmail(authorUserId, { title, body, url: href, tag: 'idea-shipped' })

  let push: IdeaShippedReward['push'] = 'sent'
  if ((await listPushSubscriptionsForUser(authorUserId)).length === 0) {
    push = 'no_device'
  } else {
    try {
      await sendPushToUser(authorUserId, { title, body, url: href, tag: 'idea-shipped' })
    } catch (err) {
      console.error('[board] shipped-idea push failed', { ideaId, err })
      push = 'failed'
    }
  }

  return { authorUserId, credits, judge, push }
}

import webpush from 'web-push'
import { configureWebPush } from './vapid'
import { deletePushSubscriptionById, listPushSubscriptionsForUser } from './subscription'

export type PushNotificationPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

const GONE_STATUS = new Set([404, 410])

export type SendPushResult = {
  sent: number
  failed: number
  removed: number
  errors: string[]
}

export async function sendPushToUser(
  userId: string,
  payload: PushNotificationPayload,
): Promise<SendPushResult> {
  configureWebPush()
  const subs = await listPushSubscriptionsForUser(userId)
  if (subs.length === 0) {
    throw new Error('No push subscriptions registered for this account')
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    tag: payload.tag ?? 'eigen-test',
  })

  const result: SendPushResult = { sent: 0, failed: 0, removed: 0, errors: [] }

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      )
      result.sent += 1
    } catch (e) {
      result.failed += 1
      const status = getWebPushStatusCode(e)
      if (status !== undefined && GONE_STATUS.has(status)) {
        await deletePushSubscriptionById(sub.id)
        result.removed += 1
      } else {
        result.errors.push(formatPushError(e))
      }
    }
  }

  if (result.sent === 0) {
    const detail = result.errors.length > 0 ? result.errors.join('; ') : 'all endpoints failed'
    throw new Error(`Push delivery failed: ${detail}`)
  }

  return result
}

function getWebPushStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number') {
    return (error as { statusCode: number }).statusCode
  }
  return undefined
}

function formatPushError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

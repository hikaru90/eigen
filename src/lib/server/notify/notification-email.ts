import { eq } from 'drizzle-orm'
import { env } from '$lib/server/env/private-env'
import { authDb } from '$lib/server/db/auth-db'
import { user } from '$lib/server/db/auth.schema'
import { isOwleryMailConfigured, sendTransactionalEmail } from '$lib/server/owlery/mail'
import type { PushNotificationPayload } from '$lib/server/push/send'

const EIGEN_SUBJECT_PREFIX = '[Eigen]'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Best-effort transactional email mirror of a push notification.
 *
 * Email is a secondary channel: when Owlery mail is not configured or the user has
 * no email address, this is a no-op. Send failures are logged, never thrown —
 * matching the fire-and-forget pattern in `src/lib/server/auth.ts`.
 */
export async function queueNotificationEmail(
  userId: string,
  payload: PushNotificationPayload,
): Promise<void> {
  if (!isOwleryMailConfigured(env)) return

  const [row] = await authDb
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  const to = row?.email
  if (!to) return

  const subject = `${EIGEN_SUBJECT_PREFIX} ${payload.title}`
  const link = payload.url ?? '/'
  const absoluteUrl = /^https?:\/\//i.test(link) ? link : new URL(link, env.ORIGIN).href

  const text = `${payload.title}\n\n${payload.body}\n\nOpen: ${absoluteUrl}`
  const html = [
    `<p style="font-size:16px;font-weight:600;margin:0 0 12px">${escapeHtml(payload.title)}</p>`,
    `<p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(payload.body)}</p>`,
    `<p><a href="${escapeHtml(absoluteUrl)}">Open in Eigen</a></p>`,
  ].join('')

  void sendTransactionalEmail(env, { to, subject, html, text }).catch((err) => {
    console.error('[notification-email] send failed', {
      userId,
      to,
      subject,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

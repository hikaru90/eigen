import { eq } from 'drizzle-orm'
import type { DailyDigest } from '$lib/server/memory/daily-summary'
import { authDb } from '$lib/server/db/auth-db'
import { user } from '$lib/server/db/auth.schema'
import { getDb } from '$lib/server/db'
import { userPreference } from '$lib/server/db/schema'
import { env } from '$lib/server/env/private-env'
import { isOwleryMailConfigured, sendTransactionalEmail } from '$lib/server/owlery/mail'
import { OWLERY_TEMPLATES } from '$lib/server/owlery/templates'
import {
  renderAgentsHtml,
  renderDigestText,
  renderProjectsHtml,
} from '$lib/server/notify/digest-email-html'
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
 * Shared gate for every notification email: mail configured, the user's email
 * setting allows it, and the user has an address. Returns the address or null.
 */
async function resolveEmailRecipient(userId: string): Promise<string | null> {
  if (!isOwleryMailConfigured(env)) return null

  // the user's email setting (board a286e635): off means in-app and push only.
  // A missing preference row predates the setting — the historical default (on) holds.
  const [preference] = await getDb()
    .select({ notifyByEmail: userPreference.notifyByEmail })
    .from(userPreference)
    .where(eq(userPreference.userId, userId))
    .limit(1)
  if (preference?.notifyByEmail === false) return null

  const [row] = await authDb
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return row?.email || null
}

function toAbsoluteUrl(link: string): string {
  return /^https?:\/\//i.test(link) ? link : new URL(link, env.ORIGIN).href
}

function logSendFailure(userId: string, to: string, subject: string, err: unknown): void {
  console.error('[notification-email] send failed', {
    userId,
    to,
    subject,
    error: err instanceof Error ? err.message : String(err),
  })
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
  const to = await resolveEmailRecipient(userId)
  if (!to) return

  const subject = `${EIGEN_SUBJECT_PREFIX} ${payload.title}`
  const absoluteUrl = toAbsoluteUrl(payload.url ?? '/')

  const text = `${payload.title}\n\n${payload.body}\n\nOpen: ${absoluteUrl}`
  const html = [
    `<p style="font-size:16px;font-weight:600;margin:0 0 12px">${escapeHtml(payload.title)}</p>`,
    `<p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(payload.body)}</p>`,
    `<p><a href="${escapeHtml(absoluteUrl)}">Open in Eigen</a></p>`,
  ].join('')

  void sendTransactionalEmail(env, { to, subject, html, text }).catch((err) =>
    logSendFailure(userId, to, subject, err),
  )
}

/**
 * Daily digest email through the Owlery digest template (variables `title`,
 * `summary`, `url`, `thoughts_filed`, `tasks_done`, `projects_html`, `agents_html`).
 * Owlery inserts variables raw, so every user-authored string is escaped here.
 * Same gate as `queueNotificationEmail`.
 */
export async function queueDigestEmail(
  userId: string,
  payload: PushNotificationPayload,
  digest: DailyDigest,
): Promise<void> {
  const to = await resolveEmailRecipient(userId)
  if (!to) return

  const templateId = OWLERY_TEMPLATES.dailyDigest

  const absoluteUrl = toAbsoluteUrl(payload.url ?? '/summary')
  const origin = env.ORIGIN.replace(/\/+$/, '')
  const text = [
    payload.title,
    payload.body,
    `Thoughts filed: ${digest.thoughtsFiled} · Tasks done: ${digest.tasksDone}`,
    renderDigestText(digest, origin),
    `Open: ${absoluteUrl}`,
  ].join('\n\n')
  const variables = {
    title: escapeHtml(payload.title),
    summary: escapeHtml(payload.body),
    url: escapeHtml(absoluteUrl),
    thoughts_filed: String(digest.thoughtsFiled),
    tasks_done: String(digest.tasksDone),
    projects_html: renderProjectsHtml(digest, origin),
    agents_html: renderAgentsHtml(digest, origin),
  }

  void sendTransactionalEmail(env, { to, templateId, variables, text }).catch((err) =>
    logSendFailure(userId, to, `digest:${templateId}`, err),
  )
}

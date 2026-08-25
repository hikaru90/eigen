import { env } from '$env/dynamic/private'
import {
  isUseSendMailConfigured,
  sendTransactionalEmail,
} from '$lib/server/email/usesend'

/** Product inbox for user-submitted feedback (useSend transactional). */
export const FEEDBACK_INBOX_EMAIL = 'feedback@eigenmesh.xyz'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Throws when useSend is not configured — feedback delivery requires email. */
export function assertFeedbackMailConfigured(): void {
  if (!isUseSendMailConfigured(env)) {
    throw new Error(
      'Feedback email is not configured (set USESEND_API_KEY, USESEND_BASE_URL, and USESEND_EMAIL_FROM)',
    )
  }
}

export type SendFeedbackInboxEmailInput = {
  feedbackId: string
  userId: string
  userEmail: string
  message: string
}

/**
 * Delivers product feedback to the Eigen inbox via useSend.
 * Propagates send failures — no silent swallow (see AGENTS.md failure policy).
 */
export async function sendFeedbackInboxEmail(
  input: SendFeedbackInboxEmailInput,
): Promise<{ emailId: string | null }> {
  const subject = `[Eigen] Product feedback from ${input.userEmail}`
  const text = [
    'New product feedback',
    '',
    `From: ${input.userEmail}`,
    `User id: ${input.userId}`,
    `Feedback id: ${input.feedbackId}`,
    '',
    input.message,
  ].join('\n')

  const html = [
    `<p style="font-size:16px;font-weight:600;margin:0 0 12px">New product feedback</p>`,
    `<p style="margin:0 0 8px"><strong>From:</strong> ${escapeHtml(input.userEmail)}</p>`,
    `<p style="margin:0 0 8px"><strong>User id:</strong> ${escapeHtml(input.userId)}</p>`,
    `<p style="margin:0 0 16px"><strong>Feedback id:</strong> ${escapeHtml(input.feedbackId)}</p>`,
    `<p style="margin:0;white-space:pre-line">${escapeHtml(input.message)}</p>`,
  ].join('')

  return sendTransactionalEmail(env, {
    to: FEEDBACK_INBOX_EMAIL,
    replyTo: input.userEmail,
    subject,
    html,
    text,
  })
}

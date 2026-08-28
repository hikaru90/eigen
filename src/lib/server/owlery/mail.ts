import { type OwleryEnv, resolveOwleryMailConfig } from './config'

export type SendTransactionalEmailInput = {
  to: string
  subject: string
  html: string
  text: string
  /** Optional Reply-To so inbox replies reach the submitter. */
  replyTo?: string
}

/**
 * Sends one transactional email via Owlery REST (`POST /api/v1/emails`).
 * Throws if Owlery mail is not configured or the API rejects the send.
 */
export async function sendTransactionalEmail(
  env: OwleryEnv,
  input: SendTransactionalEmailInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ emailId: string | null }> {
  const config = resolveOwleryMailConfig(env)
  if (!config) {
    throw new Error(
      'Transactional email is not configured (set OWLERY_API_KEY, OWLERY_BASE_URL, and OWLERY_EMAIL_FROM)',
    )
  }

  const url = `${config.baseUrl}/api/v1/emails`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      to: input.to,
      from: config.from,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    }),
  })

  const bodyText = await response.text()
  let parsed: { emailId?: string; message?: string } | null = null
  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText) as { emailId?: string; message?: string }
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const detail = parsed?.message ?? (bodyText.slice(0, 500) || response.statusText)
    throw new Error(`Owlery send failed (${response.status}): ${detail}`)
  }

  return { emailId: typeof parsed?.emailId === 'string' ? parsed.emailId : null }
}

export { isOwleryMailConfigured, resolveOwleryMailConfig } from './config'

/**
 * Onboarding contact book sync via Owlery (REST).
 * Contacts are added only after Eigen email confirmation — see auth hooks.
 * @see POST /api/v1/contactBooks/{contactBookId}/contacts
 */

import { type OwleryEnv, resolveOwleryContactBookConfig } from './config'

export type CreateOwleryContactInput = {
  email: string
  firstName?: string
  lastName?: string
}

/**
 * Creates one contact in the onboarding book. Throws if the contact book is not configured
 * or the API rejects the request.
 */
export async function createOwleryContact(
  env: OwleryEnv,
  input: CreateOwleryContactInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ contactId: string | null }> {
  const config = resolveOwleryContactBookConfig(env)
  if (!config) {
    throw new Error(
      'Owlery onboarding list is not configured (set OWLERY_API_KEY, OWLERY_BASE_URL, OWLERY_EMAIL_FROM, and OWLERY_CONTACT_BOOK_ID)',
    )
  }

  const url = `${config.baseUrl}/api/v1/contactBooks/${encodeURIComponent(config.contactBookId)}/contacts`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      email: input.email,
      subscribed: true,
      // Eigen verified this address itself (its verification email) — mark pre-confirmed
      // so Owlery does not send its own double opt-in email.
      emailConfirmed: true,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
    }),
  })

  const bodyText = await response.text()
  let parsed: { contactId?: string; message?: string } | null = null
  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText) as { contactId?: string; message?: string }
    } catch {
      parsed = null
    }
  }

  if (!response.ok) {
    const detail = parsed?.message ?? (bodyText.slice(0, 500) || response.statusText)
    throw new Error(`Owlery contact create failed (${response.status}): ${detail}`)
  }

  return { contactId: typeof parsed?.contactId === 'string' ? parsed.contactId : null }
}

export {
  isOwleryContactBookConfigured as isOwleryConfigured,
  resolveOwleryContactBookConfig as resolveOwleryConfig,
} from './config'

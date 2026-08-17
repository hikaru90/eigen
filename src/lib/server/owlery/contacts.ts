/**
 * Mailing-list contact sync via Owlery (REST).
 * New auth users (email/password and OAuth) are created as contacts on signup.
 * @see POST /api/v1/contactBooks/{contactBookId}/contacts
 */

export type OwleryEnv = {
  OWLERY_API_KEY?: string
  OWLERY_BASE_URL?: string
  OWLERY_CONTACT_BOOK_ID?: string
  /** SvelteKit's `$env/dynamic/private` carries arbitrary keys alongside the declared ones. */
  [key: string]: string | undefined
}

export type CreateOwleryContactInput = {
  email: string
  firstName?: string
  lastName?: string
}

export type OwleryConfig = {
  apiKey: string
  baseUrl: string
  contactBookId: string
}

function readRequired(env: OwleryEnv, key: keyof OwleryEnv): string | undefined {
  const value = env[key]?.trim()
  return value || undefined
}

/** Returns Owlery config when all three env vars are set; otherwise `null` (contact sync stays off). */
export function resolveOwleryConfig(env: OwleryEnv): OwleryConfig | null {
  const apiKey = readRequired(env, 'OWLERY_API_KEY')
  const baseUrl = readRequired(env, 'OWLERY_BASE_URL')
  const contactBookId = readRequired(env, 'OWLERY_CONTACT_BOOK_ID')
  if (!apiKey || !baseUrl || !contactBookId) return null
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), contactBookId }
}

export function isOwleryConfigured(env: OwleryEnv): boolean {
  return resolveOwleryConfig(env) !== null
}

/**
 * Creates one contact in the configured contact book. Throws if Owlery is not configured
 * or the API rejects the request. No silent degradation — callers must only invoke this
 * when Owlery is configured. The API key never appears in thrown errors.
 */
export async function createOwleryContact(
  env: OwleryEnv,
  input: CreateOwleryContactInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ contactId: string | null }> {
  const config = resolveOwleryConfig(env)
  if (!config) {
    throw new Error(
      'Owlery is not configured (set OWLERY_API_KEY, OWLERY_BASE_URL, and OWLERY_CONTACT_BOOK_ID)',
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

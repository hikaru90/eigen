/**
 * Owlery — transactional email + contact books (drop-in replacement for useSend).
 */

export type OwleryEnv = {
  OWLERY_API_KEY?: string
  OWLERY_BASE_URL?: string
  OWLERY_EMAIL_FROM?: string
  OWLERY_CONTACT_BOOK_ID?: string
  /** SvelteKit's `$env/dynamic/private` carries arbitrary keys alongside the declared ones. */
  [key: string]: string | undefined
}

export type OwleryMailConfig = {
  apiKey: string
  baseUrl: string
  from: string
}

export type OwleryContactBookConfig = OwleryMailConfig & {
  contactBookId: string
}

function readRequired(env: OwleryEnv, key: keyof OwleryEnv): string | undefined {
  const value = env[key]?.trim()
  return value || undefined
}

/** Mail sending (verification, reset, notifications) — requires API key, base URL, and from. */
export function resolveOwleryMailConfig(env: OwleryEnv): OwleryMailConfig | null {
  const apiKey = readRequired(env, 'OWLERY_API_KEY')
  const baseUrl = readRequired(env, 'OWLERY_BASE_URL')
  const from = readRequired(env, 'OWLERY_EMAIL_FROM')
  if (!apiKey || !baseUrl || !from) return null
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), from }
}

export function isOwleryMailConfigured(env: OwleryEnv): boolean {
  return resolveOwleryMailConfig(env) !== null
}

/** Onboarding contact book sync — mail config plus contact book id. */
export function resolveOwleryContactBookConfig(env: OwleryEnv): OwleryContactBookConfig | null {
  const mail = resolveOwleryMailConfig(env)
  const contactBookId = readRequired(env, 'OWLERY_CONTACT_BOOK_ID')
  if (!mail || !contactBookId) return null
  return { ...mail, contactBookId }
}

export function isOwleryContactBookConfigured(env: OwleryEnv): boolean {
  return resolveOwleryContactBookConfig(env) !== null
}

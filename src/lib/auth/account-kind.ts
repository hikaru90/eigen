/** Persisted account classification — set at creation, not inferred at runtime. */
export type UserAccountKind = 'production' | 'harness'

/** Reserved signup domains for eval, LongMemEval, and Playwright harness tenants. */
export const HARNESS_EMAIL_DOMAINS = ['local.eval', 'test.eigen'] as const

/** Assign account kind when provisioning a new user row (signup or harness bootstrap). */
export function resolveAccountKindForNewUser(email: string): UserAccountKind {
  const at = email.lastIndexOf('@')
  if (at < 0) return 'production'
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return (HARNESS_EMAIL_DOMAINS as readonly string[]).includes(domain) ? 'harness' : 'production'
}

export function accountKindLabel(kind: UserAccountKind): string {
  return kind === 'harness' ? 'Harness' : 'Production'
}

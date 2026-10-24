/** Shared onboarding + PWA welcome-push constants (safe for client and server). */

/** Delay after PWA install before the first grounding push. */
export const ONBOARDING_GROUNDING_PUSH_DELAY_MS = 30_000

export const ONBOARDING_WELCOME_URL = '/notifications?welcome=1'

export const ONBOARDING_WELCOME_PUSH_TITLE = 'One quick question'

export const ONBOARDING_FIRST_TEMPLATE_ID = 'work_where' as const

import { env } from '$lib/server/env/private-env'
import { createOwleryContact, isOwleryConfigured } from '$lib/server/owlery/contacts'

export type OwlerySyncUser = {
  id: string
  email?: string | null
  emailVerified?: boolean | null
  firstName?: string | null
  lastName?: string | null
}

/** Mailing-list contact sync — only after the user's email is confirmed (double opt-in). */
export async function syncOwleryContactForVerifiedUser(user: OwlerySyncUser): Promise<void> {
  if (!isOwleryConfigured(env)) return
  if (!user.emailVerified) return

  const email = user.email?.trim()
  if (!email) return

  try {
    await createOwleryContact(env, {
      email,
      ...(user.firstName ? { firstName: user.firstName } : {}),
      ...(user.lastName ? { lastName: user.lastName } : {}),
    })
  } catch (err) {
    console.error('[auth] owlery contact sync failed', {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

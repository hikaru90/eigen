import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { consumeVerificationLink } from '$lib/server/e2e/verification-link-store'

export const GET: RequestHandler = ({ url }) => {
  if (!dev) {
    return json({ error: 'Verification link API only available in dev mode' }, { status: 403 })
  }

  const email = url.searchParams.get('email')?.trim()
  if (!email) {
    error(400, 'email query param is required')
  }

  const link = consumeVerificationLink(email)
  return json({ link: link ?? null })
}

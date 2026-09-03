import { error, type RequestEvent } from '@sveltejs/kit'
import { env } from '$lib/server/env/private-env'

export function isEigenAdminKeyConfigured(): boolean {
  return !!env.ADMIN_CONSOLIDATION_KEY?.trim()
}

/** Key-only gate for cross-tenant admin read APIs (website → app). */
export function requireAdminKey(event: RequestEvent): void {
  const configured = env.ADMIN_CONSOLIDATION_KEY?.trim()
  const sent = event.request.headers.get('x-admin-key')?.trim()
  if (!configured || !sent || sent !== configured) {
    error(401, 'Unauthorized')
  }
}

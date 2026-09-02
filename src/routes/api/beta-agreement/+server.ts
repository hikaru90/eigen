import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { acceptBetaAgreement } from '$lib/server/beta-agreement'

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  try {
    await acceptBetaAgreement(user.id)
    return json({ accepted: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    error(500, msg)
  }
}

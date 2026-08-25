/**
 * POST /api/admin/users/:id/credits
 *
 * Grant platform credits (admin refund / goodwill). Session admin only.
 * Body: { amountCredits: number, reason: string }
 */

import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/require-admin'
import { adminGrantCredits, MAX_ADMIN_GRANT_CREDITS } from '$lib/server/billing/wallet'

export const POST: RequestHandler = async (event) => {
  const admin = await requireAdmin(event.locals.user)
  const userId = event.params.id?.trim()
  if (!userId) {
    return json({ error: 'User id is required' }, { status: 400 })
  }

  let body: { amountCredits?: unknown; reason?: unknown }
  try {
    body = (await event.request.json()) as { amountCredits?: unknown; reason?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const amountCredits =
    typeof body.amountCredits === 'number'
      ? body.amountCredits
      : typeof body.amountCredits === 'string'
        ? Number(body.amountCredits)
        : NaN
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (!Number.isInteger(amountCredits) || amountCredits < 1) {
    return json({ error: 'amountCredits must be a positive integer' }, { status: 400 })
  }
  if (amountCredits > MAX_ADMIN_GRANT_CREDITS) {
    return json(
      { error: `amountCredits cannot exceed ${MAX_ADMIN_GRANT_CREDITS}` },
      { status: 400 },
    )
  }
  if (!reason) {
    return json({ error: 'reason is required' }, { status: 400 })
  }

  try {
    const result = await adminGrantCredits({
      userId,
      amountCredits,
      reason,
      adminUserId: admin.id,
    })
    return json({
      ok: true,
      availableCredits: result.availableCredits,
      amountCredits,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: message }, { status: 400 })
  }
}

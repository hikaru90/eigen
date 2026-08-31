import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/require-admin'
import { enqueueErpNextInvoiceBackfill } from '$lib/server/billing/erpnext-invoice-push'

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

export const POST: RequestHandler = async (event) => {
  await requireAdmin(event.locals.user)

  const limitParam = event.url.searchParams.get('limit')
  const limit = parseLimit(limitParam)
  if (limitParam && !limit) {
    return json({ error: 'limit must be a positive integer' }, { status: 400 })
  }

  const result = await enqueueErpNextInvoiceBackfill({ limit })
  return json(result)
}

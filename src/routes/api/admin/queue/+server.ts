import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { requireAdmin } from '$lib/server/auth/require-admin'
import {
  loadAdminQueueDashboard,
  type AdminQueueListOptions,
} from '$lib/server/job-queue/admin-dashboard'

function parseStatus(raw: string | null): AdminQueueListOptions['status'] {
  switch (raw) {
    case 'pending':
    case 'running':
    case 'failed':
    case 'completed':
    case 'cancelled':
      return raw
    default:
      return 'all'
  }
}

export const GET: RequestHandler = async (event) => {
  await requireAdmin(event.locals.user)

  const status = parseStatus(event.url.searchParams.get('status'))
  const includeHarness = event.url.searchParams.get('harness') === '1'
  const dashboard = await loadAdminQueueDashboard({ status, includeHarness })

  return json({ ok: true, ...dashboard })
}

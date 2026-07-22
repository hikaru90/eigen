import type { PageServerLoad } from './$types'
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

export const load: PageServerLoad = async (event) => {
  const status = parseStatus(event.url.searchParams.get('status'))
  const includeHarness = event.url.searchParams.get('harness') === '1'
  const dashboard = await loadAdminQueueDashboard({ status, includeHarness })

  return {
    dashboard,
    status,
    includeHarness,
  }
}

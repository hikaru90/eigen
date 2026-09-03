import type { PageServerLoad } from './$types'
import {
  listAdminActivityCalls,
  listAdminSpendByUser,
  parseAdminSpendPage,
  parseAdminSpendSort,
  parseAdminSpendView,
  resolveAdminUserByQuery,
} from '$lib/server/billing/admin-spend'
import { loadErpNextSyncStatus } from '$lib/server/billing/erpnext-invoice-push'

function parseDateParam(raw: string | null): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function defaultLast30Days(): { from: Date; to: Date } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from, to }
}

export const load: PageServerLoad = async (event) => {
  const allTime = event.url.searchParams.get('all') === '1'
  const includeHarness = event.url.searchParams.get('harness') === '1'
  const fromParam = event.url.searchParams.get('from')
  const toParam = event.url.searchParams.get('to')
  const search = event.url.searchParams.get('q')?.trim() ?? ''
  const userQuery = event.url.searchParams.get('user')?.trim() ?? ''
  const page = parseAdminSpendPage(event.url.searchParams.get('page'))
  const sort = parseAdminSpendSort(event.url.searchParams.get('sort'))
  const sortAsc = event.url.searchParams.get('dir') === 'asc'
  const view = parseAdminSpendView(event.url.searchParams.get('view'))

  let from: Date | null = parseDateParam(fromParam)
  let to: Date | null = parseDateParam(toParam)
  let rangeMode: 'all' | 'custom' | 'last30' = 'last30'

  if (allTime) {
    from = null
    to = null
    rangeMode = 'all'
  } else if (fromParam || toParam) {
    rangeMode = 'custom'
  } else {
    const defaults = defaultLast30Days()
    from = defaults.from
    to = defaults.to
  }

  const userFilter = userQuery ? await resolveAdminUserByQuery(userQuery) : null

  const erpNext = await loadErpNextSyncStatus()

  const spendResult = await listAdminSpendByUser({
    from,
    to,
    includeHarness,
    search: view === 'users' && search ? search : undefined,
    page: view === 'users' ? page : 1,
    sort,
    sortAsc,
  })

  const callsResult =
    view === 'calls'
      ? await listAdminActivityCalls({
          from,
          to,
          includeHarness,
          userId: userFilter?.userId,
          search: search || undefined,
          page,
        })
      : null

  return {
    view,
    erpNext,
    rows: spendResult.rows,
    totals: spendResult.totals,
    pagination:
      view === 'users'
        ? spendResult.pagination
        : (callsResult?.pagination ?? spendResult.pagination),
    calls: callsResult?.calls ?? [],
    callTotals: callsResult?.totals ?? { callCount: 0, totalCostUsd: '0.000000' },
    callPagination: callsResult?.pagination ?? {
      page: 1,
      pageSize: 50,
      totalCount: 0,
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
    },
    userFilter,
    userQuery,
    search,
    sort,
    sortAsc,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    rangeMode,
    includeHarness,
  }
}

import type { PageServerLoad } from './$types'
import {
  listAdminSpendByUser,
  parseAdminSpendPage,
  parseAdminSpendSort,
} from '$lib/server/billing/admin-spend'

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
  const page = parseAdminSpendPage(event.url.searchParams.get('page'))
  const sort = parseAdminSpendSort(event.url.searchParams.get('sort'))
  const sortAsc = event.url.searchParams.get('dir') === 'asc'

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

  const result = await listAdminSpendByUser({
    from,
    to,
    includeHarness,
    search: search || undefined,
    page,
    sort,
    sortAsc,
  })

  return {
    rows: result.rows,
    totals: result.totals,
    pagination: result.pagination,
    search,
    sort,
    sortAsc,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    rangeMode,
    includeHarness,
  }
}

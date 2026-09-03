import type { UserAccountKind } from '$lib/server/db/auth.schema'
import type { BillingMode } from '$lib/server/db/brain.schema'
import { createAdminSql } from '$lib/server/job-queue/admin-db'

export type AdminSpendRow = {
  userId: string
  email: string
  name: string | null
  accountKind: UserAccountKind
  billingMode: BillingMode
  availableCredits: number
  totalGatewayCostUsd: string
  totalCreditsDebited: number
  lastActivityAt: Date | null
}

export type AdminSpendTotals = {
  totalGatewayCostUsd: string
  totalCreditsDebited: number
  userCount: number
}

export type AdminSpendDateRange = {
  from: Date | null
  to: Date | null
}

export type AdminSpendSortKey =
  | 'email'
  | 'billingMode'
  | 'availableCredits'
  | 'totalGatewayCostUsd'
  | 'totalCreditsDebited'
  | 'lastActivityAt'

export type AdminSpendListOptions = AdminSpendDateRange & {
  /** When false (default), only production signups are listed. */
  includeHarness?: boolean
  search?: string
  page?: number
  pageSize?: number
  sort?: AdminSpendSortKey
  sortAsc?: boolean
}

export type AdminSpendPagination = {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasPrev: boolean
  hasNext: boolean
}

export type AdminSpendListResult = {
  rows: AdminSpendRow[]
  totals: AdminSpendTotals
  pagination: AdminSpendPagination
}

export type AdminSpendView = 'users' | 'calls'

export type AdminSpendActivityCallRow = {
  id: string
  userId: string
  userEmail: string
  userName: string | null
  provider: string
  gatewayHost: string | null
  operation: string
  context: string | null
  baseCostUsd: string
  markupUsd: string
  totalCostUsd: string
  groupId: string | null
  durationMs: number | null
  createdAt: string
}

export type AdminSpendActivityCallsTotals = {
  callCount: number
  totalCostUsd: string
}

export type AdminSpendActivityCallsResult = {
  calls: AdminSpendActivityCallRow[]
  totals: AdminSpendActivityCallsTotals
  pagination: AdminSpendPagination
}

export type AdminSpendActivityCallsOptions = AdminSpendDateRange & {
  includeHarness?: boolean
  userId?: string
  search?: string
  page?: number
  pageSize?: number
}

export type AdminSpendUserRef = {
  userId: string
  email: string
  name: string | null
}

const DEFAULT_PAGE_SIZE = 25
const DEFAULT_CALLS_PAGE_SIZE = 50

export function parseAdminSpendPage(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export function parseAdminSpendView(raw: string | null | undefined): AdminSpendView {
  return raw === 'calls' ? 'calls' : 'users'
}

export function parseAdminSpendSort(raw: string | null | undefined): AdminSpendSortKey {
  const keys: AdminSpendSortKey[] = [
    'email',
    'billingMode',
    'availableCredits',
    'totalGatewayCostUsd',
    'totalCreditsDebited',
    'lastActivityAt',
  ]
  return keys.includes(raw as AdminSpendSortKey)
    ? (raw as AdminSpendSortKey)
    : 'totalGatewayCostUsd'
}

type AdminSpendDbRow = {
  user_id: string
  email: string
  name: string | null
  account_kind: string | null
  billing_mode: string | null
  available_credits: number | null
  total_gateway_cost_usd: string | number | null
  total_credits_debited: string | number | null
  last_activity_at: Date | null
}

export function mapAdminSpendDbRow(row: AdminSpendDbRow): AdminSpendRow {
  const billingMode = row.billing_mode === 'byok' ? 'byok' : 'platform_credits'
  const gatewayUsd = Number(row.total_gateway_cost_usd ?? 0)
  const creditsDebited = Number(row.total_credits_debited ?? 0)
  const accountKind = row.account_kind === 'harness' ? 'harness' : 'production'

  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    accountKind,
    billingMode,
    availableCredits: row.available_credits ?? 0,
    totalGatewayCostUsd: Number.isFinite(gatewayUsd) ? gatewayUsd.toFixed(6) : '0.000000',
    totalCreditsDebited: Number.isFinite(creditsDebited) ? Math.round(creditsDebited) : 0,
    lastActivityAt: row.last_activity_at,
  }
}

export function computeAdminSpendTotals(rows: AdminSpendRow[]): AdminSpendTotals {
  let gatewayUsd = 0
  let creditsDebited = 0
  for (const row of rows) {
    gatewayUsd += Number(row.totalGatewayCostUsd)
    creditsDebited += row.totalCreditsDebited
  }
  return {
    totalGatewayCostUsd: gatewayUsd.toFixed(6),
    totalCreditsDebited: creditsDebited,
    userCount: rows.length,
  }
}

export async function listAdminSpendByUser(
  options: AdminSpendListOptions,
): Promise<AdminSpendListResult> {
  const sql = createAdminSql(1)
  const includeHarness = options.includeHarness === true
  const search = options.search?.trim() ?? ''
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const sort = options.sort ?? 'totalGatewayCostUsd'
  const sortAsc = options.sortAsc ?? false
  const page = parseAdminSpendPage(String(options.page ?? 1))
  const searchPattern = search ? `%${search}%` : null

  const orderColumn =
    sort === 'email'
      ? sql`u.email`
      : sort === 'billingMode'
        ? sql`up.billing_mode`
        : sort === 'availableCredits'
          ? sql`COALESCE(uw.available_credits, 0)`
          : sort === 'totalCreditsDebited'
            ? sql`COALESCE(ledger.total_credits_debited, 0)`
            : sort === 'lastActivityAt'
              ? sql`act.last_activity_at`
              : sql`COALESCE(act.total_gateway_cost_usd, 0)`
  const orderDirection = sortAsc ? sql`ASC` : sql`DESC`

  const baseFrom = sql`
		FROM "user" u
		LEFT JOIN user_preference up ON up.user_id = u.id
		LEFT JOIN user_wallet uw ON uw.user_id = u.id
		LEFT JOIN (
			SELECT
				acl.user_id,
				SUM(acl.total_cost_usd::numeric) AS total_gateway_cost_usd,
				MAX(acl.created_at) AS last_activity_at
			FROM activity_call_log acl
			WHERE acl.total_cost_usd::numeric > 0
				${options.from ? sql`AND acl.created_at >= ${options.from}` : sql``}
				${options.to ? sql`AND acl.created_at <= ${options.to}` : sql``}
			GROUP BY acl.user_id
		) act ON act.user_id = u.id
		LEFT JOIN (
			SELECT
				wle.user_id,
				SUM(ABS(wle.amount_credits)) AS total_credits_debited
			FROM wallet_ledger_entry wle
			WHERE wle.kind = 'usage_debit'
				${options.from ? sql`AND wle.created_at >= ${options.from}` : sql``}
				${options.to ? sql`AND wle.created_at <= ${options.to}` : sql``}
			GROUP BY wle.user_id
		) ledger ON ledger.user_id = u.id
		WHERE 1 = 1
			${includeHarness ? sql`` : sql`AND u.account_kind = 'production'`}
			${
        searchPattern
          ? sql`AND (u.email ILIKE ${searchPattern} OR COALESCE(u.name, '') ILIKE ${searchPattern})`
          : sql``
      }
	`

  try {
    const [countRow] = await sql<
      Array<{
        user_count: number
        total_gateway_cost_usd: string | number | null
        total_credits_debited: string | number | null
      }>
    >`
			SELECT
				COUNT(*)::int AS user_count,
				COALESCE(SUM(COALESCE(act.total_gateway_cost_usd, 0)), 0) AS total_gateway_cost_usd,
				COALESCE(SUM(COALESCE(ledger.total_credits_debited, 0)), 0) AS total_credits_debited
			${baseFrom}
		`

    const totalCount = countRow?.user_count ?? 0
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
    const safePage = Math.min(page, totalPages)
    const offset = (safePage - 1) * pageSize

    const rows = await sql<AdminSpendDbRow[]>`
			SELECT
				u.id AS user_id,
				u.email,
				u.name,
				u.account_kind,
				up.billing_mode,
				uw.available_credits,
				COALESCE(act.total_gateway_cost_usd, 0) AS total_gateway_cost_usd,
				COALESCE(ledger.total_credits_debited, 0) AS total_credits_debited,
				act.last_activity_at
			${baseFrom}
			ORDER BY ${orderColumn} ${orderDirection}, u.email ASC
			LIMIT ${pageSize}
			OFFSET ${offset}
		`

    const gatewayUsd = Number(countRow?.total_gateway_cost_usd ?? 0)
    const creditsDebited = Number(countRow?.total_credits_debited ?? 0)

    return {
      rows: rows.map(mapAdminSpendDbRow),
      totals: {
        totalGatewayCostUsd: Number.isFinite(gatewayUsd) ? gatewayUsd.toFixed(6) : '0.000000',
        totalCreditsDebited: Number.isFinite(creditsDebited) ? Math.round(creditsDebited) : 0,
        userCount: totalCount,
      },
      pagination: {
        page: safePage,
        pageSize,
        totalCount,
        totalPages,
        hasPrev: safePage > 1,
        hasNext: safePage < totalPages,
      },
    }
  } finally {
    await sql.end()
  }
}

function toActivityCallIso(value: Date | string | null | undefined): string {
  if (value == null) return ''
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

type AdminActivityCallDbRow = {
  id: string
  user_id: string
  user_email: string
  user_name: string | null
  provider: string
  gateway_host: string | null
  operation: string
  context: string | null
  base_cost_usd: string
  markup_usd: string
  total_cost_usd: string
  group_id: string | null
  duration_ms: number | null
  created_at: Date | string
}

function mapAdminActivityCallDbRow(row: AdminActivityCallDbRow): AdminSpendActivityCallRow {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    provider: row.provider,
    gatewayHost: row.gateway_host,
    operation: row.operation,
    context: row.context,
    baseCostUsd: row.base_cost_usd,
    markupUsd: row.markup_usd,
    totalCostUsd: row.total_cost_usd,
    groupId: row.group_id,
    durationMs: row.duration_ms,
    createdAt: toActivityCallIso(row.created_at),
  }
}

/** Resolve a user by exact id or email (case-insensitive). */
export async function resolveAdminUserByQuery(query: string): Promise<AdminSpendUserRef | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  const sql = createAdminSql(1)
  try {
    const rows = await sql<Array<{ user_id: string; email: string; name: string | null }>>`
      SELECT u.id AS user_id, u.email, u.name
      FROM "user" u
      WHERE u.id = ${trimmed}
        OR lower(u.email) = lower(${trimmed})
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return { userId: row.user_id, email: row.email, name: row.name }
  } finally {
    await sql.end()
  }
}

/** Paginated activity_call_log across users (admin spend drill-down). */
export async function listAdminActivityCalls(
  options: AdminSpendActivityCallsOptions,
): Promise<AdminSpendActivityCallsResult> {
  const sql = createAdminSql(1)
  const includeHarness = options.includeHarness === true
  const search = options.search?.trim() ?? ''
  const pageSize = options.pageSize ?? DEFAULT_CALLS_PAGE_SIZE
  const page = parseAdminSpendPage(String(options.page ?? 1))
  const searchPattern = search ? `%${search}%` : null
  const userId = options.userId?.trim() ?? ''

  const baseFrom = sql`
    FROM activity_call_log acl
    INNER JOIN "user" u ON u.id = acl.user_id
    WHERE 1 = 1
      ${includeHarness ? sql`` : sql`AND u.account_kind = 'production'`}
      ${options.from ? sql`AND acl.created_at >= ${options.from}` : sql``}
      ${options.to ? sql`AND acl.created_at <= ${options.to}` : sql``}
      ${userId ? sql`AND acl.user_id = ${userId}` : sql``}
      ${
        searchPattern
          ? sql`AND (
              u.email ILIKE ${searchPattern}
              OR COALESCE(u.name, '') ILIKE ${searchPattern}
              OR acl.operation ILIKE ${searchPattern}
              OR COALESCE(acl.context, '') ILIKE ${searchPattern}
            )`
          : sql``
      }
  `

  try {
    const [countRow] = await sql<
      Array<{ call_count: number; total_cost_usd: string | number | null }>
    >`
      SELECT
        COUNT(*)::int AS call_count,
        COALESCE(SUM(acl.total_cost_usd::numeric), 0) AS total_cost_usd
      ${baseFrom}
    `

    const totalCount = countRow?.call_count ?? 0
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
    const safePage = Math.min(page, totalPages)
    const offset = (safePage - 1) * pageSize
    const totalCostUsd = Number(countRow?.total_cost_usd ?? 0)

    const rows = await sql<AdminActivityCallDbRow[]>`
      SELECT
        acl.id,
        u.id AS user_id,
        u.email AS user_email,
        u.name AS user_name,
        acl.provider,
        acl.gateway_host,
        acl.operation,
        acl.context,
        acl.base_cost_usd,
        acl.markup_usd,
        acl.total_cost_usd,
        acl.group_id,
        acl.duration_ms,
        acl.created_at
      ${baseFrom}
      ORDER BY acl.created_at DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `

    return {
      calls: rows.map(mapAdminActivityCallDbRow),
      totals: {
        callCount: totalCount,
        totalCostUsd: Number.isFinite(totalCostUsd) ? totalCostUsd.toFixed(6) : '0.000000',
      },
      pagination: {
        page: safePage,
        pageSize,
        totalCount,
        totalPages,
        hasPrev: safePage > 1,
        hasNext: safePage < totalPages,
      },
    }
  } finally {
    await sql.end()
  }
}

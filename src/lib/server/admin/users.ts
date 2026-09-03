import { createAdminSql } from '$lib/server/job-queue/admin-db'

/** Website ProductUserRow contract (ISO timestamps as strings). */
export type ProductUserRow = {
  userId: string
  email: string
  name: string
  createdAt: string | null
  accountKind: string | null
  billingMode: string | null
  availableCredits: number | null
  totalCreditsDebited: number | null
  totalGatewayCostUsd: number | null
  thoughtCount: number | null
  chatCount: number | null
  onboardingCompleted: boolean | null
  lastActivityAt: string | null
}

export type ProductUserDetail = ProductUserRow & {
  tokensUsed: number | null
  chatMessageCount: number | null
}

export type AdminUsersSortKey =
  'createdAt' | 'email' | 'totalCreditsDebited' | 'totalGatewayCostUsd' | 'lastActivityAt'

export type AdminUsersDir = 'asc' | 'desc'

export type AdminUsersListOptions = {
  q?: string
  page?: number
  limit?: number
  sort?: AdminUsersSortKey
  dir?: AdminUsersDir
}

export type AdminUsersListResult = {
  users: ProductUserRow[]
  total: number
  page: number
  limit: number
  totals: {
    users: number
    creditsUsed: number
    spendUsd: number
  }
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const SORT_KEYS: AdminUsersSortKey[] = [
  'createdAt',
  'email',
  'totalCreditsDebited',
  'totalGatewayCostUsd',
  'lastActivityAt',
]

export function parseAdminUsersPage(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export function parseAdminUsersLimit(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? String(DEFAULT_LIMIT), 10)
  if (!Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, n))
}

export function parseAdminUsersSort(raw: string | null | undefined): AdminUsersSortKey {
  return SORT_KEYS.includes(raw as AdminUsersSortKey) ? (raw as AdminUsersSortKey) : 'createdAt'
}

export function parseAdminUsersDir(raw: string | null | undefined): AdminUsersDir {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'asc' ? 'asc' : 'desc'
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toGatewayUsd(value: string | number | null | undefined): number | null {
  const n = toNullableNumber(value)
  if (n == null) return null
  return Number(n.toFixed(6))
}

type AdminUserDbRow = {
  user_id: string
  email: string
  name: string | null
  created_at: Date | string | null
  account_kind: string | null
  billing_mode: string | null
  available_credits: number | null
  total_credits_debited: string | number | null
  total_gateway_cost_usd: string | number | null
  thought_count: number | null
  chat_count: number | null
  chat_message_count: number | null
  onboarding_completed: boolean | null
  last_activity_at: Date | string | null
}

function mapProductUserRow(row: AdminUserDbRow): ProductUserRow {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name ?? '',
    createdAt: toIso(row.created_at),
    accountKind: row.account_kind,
    billingMode: row.billing_mode,
    availableCredits: row.available_credits == null ? null : Number(row.available_credits),
    totalCreditsDebited:
      row.total_credits_debited == null ? null : Math.round(Number(row.total_credits_debited)),
    totalGatewayCostUsd: toGatewayUsd(row.total_gateway_cost_usd),
    thoughtCount: row.thought_count == null ? null : Number(row.thought_count),
    chatCount: row.chat_count == null ? null : Number(row.chat_count),
    onboardingCompleted: row.onboarding_completed,
    lastActivityAt: toIso(row.last_activity_at),
  }
}

function mapProductUserDetail(row: AdminUserDbRow): ProductUserDetail {
  return {
    ...mapProductUserRow(row),
    tokensUsed: null,
    chatMessageCount: row.chat_message_count == null ? null : Number(row.chat_message_count),
  }
}

/** Total production (product) accounts — harness excluded. */
export async function countProductUsers(): Promise<number> {
  const sql = createAdminSql(1)
  try {
    const [row] = await sql<Array<{ user_count: number }>>`
			SELECT COUNT(*)::int AS user_count
			FROM "user" u
			WHERE u.account_kind = 'production'
		`
    return row?.user_count ?? 0
  } finally {
    await sql.end()
  }
}

export async function listAdminUsers(
  options: AdminUsersListOptions = {},
): Promise<AdminUsersListResult> {
  const sql = createAdminSql(1)
  const search = options.q?.trim() ?? ''
  const limit = options.limit ?? DEFAULT_LIMIT
  const sort = options.sort ?? 'createdAt'
  const dir = options.dir ?? 'desc'
  const page = parseAdminUsersPage(String(options.page ?? 1))
  const searchPattern = search ? `%${search}%` : null

  const orderColumn =
    sort === 'email'
      ? sql`u.email`
      : sort === 'totalCreditsDebited'
        ? sql`COALESCE(ledger.total_credits_debited, 0)`
        : sort === 'totalGatewayCostUsd'
          ? sql`COALESCE(act.total_gateway_cost_usd, 0)`
          : sort === 'lastActivityAt'
            ? sql`act.last_activity_at`
            : sql`u.created_at`
  const orderDirection = dir === 'asc' ? sql`ASC` : sql`DESC`

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
			GROUP BY acl.user_id
		) act ON act.user_id = u.id
		LEFT JOIN (
			SELECT
				wle.user_id,
				SUM(ABS(wle.amount_credits)) AS total_credits_debited
			FROM wallet_ledger_entry wle
			WHERE wle.kind = 'usage_debit'
			GROUP BY wle.user_id
		) ledger ON ledger.user_id = u.id
		LEFT JOIN (
			SELECT t.user_id, COUNT(*)::int AS thought_count
			FROM thought t
			GROUP BY t.user_id
		) thoughts ON thoughts.user_id = u.id
		LEFT JOIN (
			SELECT cs.user_id, COUNT(*)::int AS chat_count
			FROM chat_session cs
			GROUP BY cs.user_id
		) chats ON chats.user_id = u.id
		WHERE u.account_kind = 'production'
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
    const totalPages = Math.max(1, Math.ceil(totalCount / limit))
    const safePage = Math.min(page, totalPages)
    const offset = (safePage - 1) * limit

    const rows = await sql<AdminUserDbRow[]>`
			SELECT
				u.id AS user_id,
				u.email,
				u.name,
				u.created_at,
				u.account_kind,
				u.onboarding_completed,
				up.billing_mode,
				uw.available_credits,
				ledger.total_credits_debited,
				act.total_gateway_cost_usd,
				thoughts.thought_count,
				chats.chat_count,
				NULL::int AS chat_message_count,
				act.last_activity_at
			${baseFrom}
			ORDER BY ${orderColumn} ${orderDirection}, u.email ASC
			LIMIT ${limit}
			OFFSET ${offset}
		`

    const gatewayUsd = Number(countRow?.total_gateway_cost_usd ?? 0)
    const creditsDebited = Number(countRow?.total_credits_debited ?? 0)

    return {
      users: rows.map(mapProductUserRow),
      total: totalCount,
      page: safePage,
      limit,
      totals: {
        users: totalCount,
        creditsUsed: Number.isFinite(creditsDebited) ? Math.round(creditsDebited) : 0,
        spendUsd: Number.isFinite(gatewayUsd) ? Number(gatewayUsd.toFixed(6)) : 0,
      },
    }
  } finally {
    await sql.end()
  }
}

export async function getAdminUserDetail(id: string): Promise<ProductUserDetail | null> {
  const trimmed = id.trim()
  if (!trimmed) return null

  const sql = createAdminSql(1)
  try {
    const rows = await sql<AdminUserDbRow[]>`
			SELECT
				u.id AS user_id,
				u.email,
				u.name,
				u.created_at,
				u.account_kind,
				u.onboarding_completed,
				up.billing_mode,
				uw.available_credits,
				ledger.total_credits_debited,
				act.total_gateway_cost_usd,
				thoughts.thought_count,
				chats.chat_count,
				msgs.chat_message_count,
				act.last_activity_at
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
				GROUP BY acl.user_id
			) act ON act.user_id = u.id
			LEFT JOIN (
				SELECT
					wle.user_id,
					SUM(ABS(wle.amount_credits)) AS total_credits_debited
				FROM wallet_ledger_entry wle
				WHERE wle.kind = 'usage_debit'
				GROUP BY wle.user_id
			) ledger ON ledger.user_id = u.id
			LEFT JOIN (
				SELECT t.user_id, COUNT(*)::int AS thought_count
				FROM thought t
				GROUP BY t.user_id
			) thoughts ON thoughts.user_id = u.id
			LEFT JOIN (
				SELECT cs.user_id, COUNT(*)::int AS chat_count
				FROM chat_session cs
				GROUP BY cs.user_id
			) chats ON chats.user_id = u.id
			LEFT JOIN (
				SELECT cm.user_id, COUNT(*)::int AS chat_message_count
				FROM chat_message cm
				GROUP BY cm.user_id
			) msgs ON msgs.user_id = u.id
			WHERE u.id = ${trimmed}
			LIMIT 1
		`

    const row = rows[0]
    return row ? mapProductUserDetail(row) : null
  } finally {
    await sql.end()
  }
}

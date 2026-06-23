import type { BillingMode } from '$lib/server/db/brain.schema';
import type { UserAccountKind } from '$lib/server/db/auth.schema';
import { createAdminSql } from '$lib/server/job-queue/admin-db';

export type AdminSpendRow = {
	userId: string;
	email: string;
	name: string | null;
	accountKind: UserAccountKind;
	billingMode: BillingMode;
	availableCredits: number;
	totalGatewayCostUsd: string;
	totalCreditsDebited: number;
	lastActivityAt: Date | null;
};

export type AdminSpendTotals = {
	totalGatewayCostUsd: string;
	totalCreditsDebited: number;
	userCount: number;
};

export type AdminSpendDateRange = {
	from: Date | null;
	to: Date | null;
};

export type AdminSpendSortKey =
	| 'email'
	| 'billingMode'
	| 'availableCredits'
	| 'totalGatewayCostUsd'
	| 'totalCreditsDebited'
	| 'lastActivityAt';

export type AdminSpendListOptions = AdminSpendDateRange & {
	/** When false (default), only production signups are listed. */
	includeHarness?: boolean;
	search?: string;
	page?: number;
	pageSize?: number;
	sort?: AdminSpendSortKey;
	sortAsc?: boolean;
};

export type AdminSpendPagination = {
	page: number;
	pageSize: number;
	totalCount: number;
	totalPages: number;
	hasPrev: boolean;
	hasNext: boolean;
};

export type AdminSpendListResult = {
	rows: AdminSpendRow[];
	totals: AdminSpendTotals;
	pagination: AdminSpendPagination;
};

const DEFAULT_PAGE_SIZE = 25;

export function parseAdminSpendPage(raw: string | null | undefined): number {
	const n = Number.parseInt(raw ?? '1', 10);
	return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function parseAdminSpendSort(raw: string | null | undefined): AdminSpendSortKey {
	const keys: AdminSpendSortKey[] = [
		'email',
		'billingMode',
		'availableCredits',
		'totalGatewayCostUsd',
		'totalCreditsDebited',
		'lastActivityAt'
	];
	return keys.includes(raw as AdminSpendSortKey) ? (raw as AdminSpendSortKey) : 'totalGatewayCostUsd';
}

type AdminSpendDbRow = {
	user_id: string;
	email: string;
	name: string | null;
	account_kind: string | null;
	billing_mode: string | null;
	available_credits: number | null;
	total_gateway_cost_usd: string | number | null;
	total_credits_debited: string | number | null;
	last_activity_at: Date | null;
};

export function mapAdminSpendDbRow(row: AdminSpendDbRow): AdminSpendRow {
	const billingMode = row.billing_mode === 'byok' ? 'byok' : 'platform_credits';
	const gatewayUsd = Number(row.total_gateway_cost_usd ?? 0);
	const creditsDebited = Number(row.total_credits_debited ?? 0);
	const accountKind = row.account_kind === 'harness' ? 'harness' : 'production';

	return {
		userId: row.user_id,
		email: row.email,
		name: row.name,
		accountKind,
		billingMode,
		availableCredits: row.available_credits ?? 0,
		totalGatewayCostUsd: Number.isFinite(gatewayUsd) ? gatewayUsd.toFixed(6) : '0.000000',
		totalCreditsDebited: Number.isFinite(creditsDebited) ? Math.round(creditsDebited) : 0,
		lastActivityAt: row.last_activity_at
	};
}

export function computeAdminSpendTotals(rows: AdminSpendRow[]): AdminSpendTotals {
	let gatewayUsd = 0;
	let creditsDebited = 0;
	for (const row of rows) {
		gatewayUsd += Number(row.totalGatewayCostUsd);
		creditsDebited += row.totalCreditsDebited;
	}
	return {
		totalGatewayCostUsd: gatewayUsd.toFixed(6),
		totalCreditsDebited: creditsDebited,
		userCount: rows.length
	};
}

export async function listAdminSpendByUser(
	options: AdminSpendListOptions
): Promise<AdminSpendListResult> {
	const sql = createAdminSql(1);
	const includeHarness = options.includeHarness === true;
	const search = options.search?.trim() ?? '';
	const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
	const sort = options.sort ?? 'totalGatewayCostUsd';
	const sortAsc = options.sortAsc ?? false;
	const page = parseAdminSpendPage(String(options.page ?? 1));
	const searchPattern = search ? `%${search}%` : null;

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
							: sql`COALESCE(act.total_gateway_cost_usd, 0)`;
	const orderDirection = sortAsc ? sql`ASC` : sql`DESC`;

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
	`;

	try {
		const [countRow] = await sql<
			Array<{
				user_count: number;
				total_gateway_cost_usd: string | number | null;
				total_credits_debited: string | number | null;
			}>
		>`
			SELECT
				COUNT(*)::int AS user_count,
				COALESCE(SUM(COALESCE(act.total_gateway_cost_usd, 0)), 0) AS total_gateway_cost_usd,
				COALESCE(SUM(COALESCE(ledger.total_credits_debited, 0)), 0) AS total_credits_debited
			${baseFrom}
		`;

		const totalCount = countRow?.user_count ?? 0;
		const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
		const safePage = Math.min(page, totalPages);
		const offset = (safePage - 1) * pageSize;

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
		`;

		const gatewayUsd = Number(countRow?.total_gateway_cost_usd ?? 0);
		const creditsDebited = Number(countRow?.total_credits_debited ?? 0);

		return {
			rows: rows.map(mapAdminSpendDbRow),
			totals: {
				totalGatewayCostUsd: Number.isFinite(gatewayUsd) ? gatewayUsd.toFixed(6) : '0.000000',
				totalCreditsDebited: Number.isFinite(creditsDebited) ? Math.round(creditsDebited) : 0,
				userCount: totalCount
			},
			pagination: {
				page: safePage,
				pageSize,
				totalCount,
				totalPages,
				hasPrev: safePage > 1,
				hasNext: safePage < totalPages
			}
		};
	} finally {
		await sql.end();
	}
}

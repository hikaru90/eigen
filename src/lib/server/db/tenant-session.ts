import type postgres from 'postgres';

/** RLS-enforced role for app queries. Session user (e.g. superuser) connects; we SET ROLE for each request. */
export function appDbRole(): string {
	const raw = process.env.APP_DB_ROLE?.trim();
	if (!raw) return 'eigen_app';
	if (!/^[a-z_][a-z0-9_]*$/i.test(raw)) {
		throw new Error('APP_DB_ROLE must be a valid PostgreSQL role name');
	}
	return raw;
}

function quoteIdent(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Activate tenant-scoped DB session on a reserved connection.
 * Superusers bypass RLS; SET ROLE switches to a non-superuser role where policies apply.
 */
export async function activateTenantDbSession(
	sql: postgres.Sql,
	userId: string
): Promise<void> {
	const role = appDbRole();
	await sql.unsafe(`SET ROLE ${quoteIdent(role)}`);
	await sql`select set_config('app.current_user_id', ${userId}, false)`;
}

/** Tear down tenant session before returning a reserved connection to the pool. */
export async function deactivateTenantDbSession(sql: postgres.Sql): Promise<void> {
	await sql`select set_config('app.current_user_id', '', false)`;
	await sql.unsafe('RESET ROLE');
}

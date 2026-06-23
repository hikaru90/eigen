import postgres from 'postgres';

export function getAdminDatabaseUrl(): string {
	const url =
		process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL?.trim() || '';
	if (!url) {
		throw new Error('DATABASE_URL is required for global job queue operations');
	}
	return url;
}

export function createAdminSql(max = 2) {
	return postgres(getAdminDatabaseUrl(), { max });
}

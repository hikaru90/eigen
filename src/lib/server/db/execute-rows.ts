/** Normalize drizzle/postgres-js execute results to a row array. */
export function rowsFromDbExecute<T = Record<string, unknown>>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	if (result && typeof result === 'object' && 'rows' in result) {
		const rows = (result as { rows?: unknown }).rows;
		return Array.isArray(rows) ? (rows as T[]) : [];
	}
	return [];
}

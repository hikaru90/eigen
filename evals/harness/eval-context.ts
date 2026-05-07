import { appSql, createScopedDrizzle, appDbAsyncLocal, type AppDatabase } from '$lib/server/db';

/**
 * Run `fn` inside an RLS-aware DB context bound to `userId`.
 *
 * Mirrors what `src/hooks.server.ts` does for HTTP requests so eval scripts can
 * reuse the same retrieval/embedding/capture functions that rely on `getDb()`.
 *
 * Fails loud on errors (no fallback) per project guardrails.
 */
export async function withEvalDb<T>(userId: string, fn: (db: AppDatabase) => Promise<T>): Promise<T> {
	const reserved = await appSql.reserve();
	try {
		await reserved`select set_config('app.current_user_id', ${userId}, false)`;
		const scopedDb = createScopedDrizzle(reserved);
		return await appDbAsyncLocal.run(scopedDb, () => fn(scopedDb));
	} finally {
		await reserved`select set_config('app.current_user_id', '', false)`;
		await reserved.release();
	}
}

/**
 * Top-level entry helper for eval scripts: ensures the postgres pool is closed
 * so the process exits even if a downstream import opened keep-alive timers.
 */
export async function runEval(main: () => Promise<void>): Promise<void> {
	let exitCode = 0;
	try {
		await main();
	} catch (err) {
		exitCode = 1;
		console.error('[eval] failed:', err instanceof Error ? err.stack ?? err.message : err);
	} finally {
		await appSql.end({ timeout: 5 });
		process.exit(exitCode);
	}
}

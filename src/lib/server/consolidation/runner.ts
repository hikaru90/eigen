/**
 * Consolidation runner.
 *
 * Orchestrates all consolidation jobs for one or all users.
 * Called by the admin cron endpoint (POST /api/admin/consolidate).
 *
 * Job execution order:
 *   1. Salience decay (cheap, always runs)
 *   2. Community detection (runs only when entity graph grew sufficiently)
 *   3. Community summary generation (runs after detection if new communities exist)
 *
 * Each job is individually try/caught so a failure in one does not block others.
 * A job log summary is returned for observability.
 */

import { eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { runSalienceDecay } from './salience-decay';
import { runCommunityDetection, shouldRunCommunityDetection } from './community-detection';
import { runCommunitySummaryGeneration } from './community-summaries';

export type ConsolidationJobResult = {
	job: string;
	ok: boolean;
	detail?: string;
	durationMs: number;
};

export type ConsolidationRunResult = {
	userId: string;
	jobs: ConsolidationJobResult[];
	totalDurationMs: number;
};

async function runJob(
	name: string,
	fn: () => Promise<unknown>
): Promise<ConsolidationJobResult> {
	const start = Date.now();
	try {
		const detail = await fn();
		return {
			job: name,
			ok: true,
			detail: typeof detail === 'number' ? `${detail} items` : undefined,
			durationMs: Date.now() - start
		};
	} catch (err) {
		return {
			job: name,
			ok: false,
			detail: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start
		};
	}
}

/**
 * Run all consolidation jobs for a single user.
 */
export async function consolidateForUser(userId: string): Promise<ConsolidationRunResult> {
	const start = Date.now();
	const jobs: ConsolidationJobResult[] = [];

	// 1. Salience decay.
	jobs.push(await runJob('salience_decay', () => runSalienceDecay(userId)));

	// 2. Community detection (conditional).
	const shouldDetect = await shouldRunCommunityDetection(userId).catch(() => false);
	if (shouldDetect) {
		const detectionResult = await runJob('community_detection', () =>
			runCommunityDetection(userId).then((r) => r.totalCommunities)
		);
		jobs.push(detectionResult);

		// 3. Community summaries (runs after detection).
		if (detectionResult.ok) {
			jobs.push(
				await runJob('community_summaries', () => runCommunitySummaryGeneration(userId))
			);
		}
	} else {
		// Still generate missing summaries even if detection didn't re-run.
		jobs.push(
			await runJob('community_summaries', () => runCommunitySummaryGeneration(userId))
		);
	}

	return { userId, jobs, totalDurationMs: Date.now() - start };
}

/**
 * Run consolidation for all users (cron entrypoint).
 * Processes users sequentially to avoid overwhelming DB/LLM capacity.
 */
export async function consolidateAllUsers(): Promise<ConsolidationRunResult[]> {
	const db = getDb();
	const users = await db.select({ id: user.id }).from(user);
	const results: ConsolidationRunResult[] = [];

	for (const u of users) {
		try {
			const result = await consolidateForUser(u.id);
			results.push(result);
			console.info('[consolidation] completed for user', {
				userId: u.id,
				jobs: result.jobs.map((j) => `${j.job}:${j.ok ? 'ok' : 'err'}`).join(','),
				durationMs: result.totalDurationMs
			});
		} catch (err) {
			console.error('[consolidation] unexpected error for user', {
				userId: u.id,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return results;
}

/**
 * Consolidation runner — nightly "sleep" for memory maintenance.
 *
 * Phase 1 (DeepSleep): declarative pruning — salience decay, ontology prune, entity repair.
 * Phase 2 (REM): integration — community detection/summaries, open-loop salience boost.
 *
 * Called by POST /api/admin/consolidate (pg_cron at 2am or manual).
 */

import { eq } from 'drizzle-orm';
import { getDb, withDbUser } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { pruneUnusedOntologyEntityKinds } from '$lib/server/ontology-db';
import { repairCanonicalEntityTypesForUser } from '$lib/server/memory/canonical-entity-admin';
import { runSalienceDecay } from './salience-decay';
import { runCommunityDetection, shouldRunCommunityDetection } from './community-detection';
import { runCommunitySummaryGeneration } from './community-summaries';
import { boostOpenLoopSalience } from './open-loop-salience';

export type ConsolidationPhase = 'deep_sleep' | 'rem';

export type ConsolidationJobResult = {
	phase: ConsolidationPhase;
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

/** Human-readable lines for failed consolidation steps (shown in UI). */
export function formatConsolidationJobErrors(jobs: ConsolidationJobResult[]): string[] {
	return jobs
		.filter((j) => !j.ok)
		.map((j) => {
			const label = j.job.replace(/_/g, ' ');
			return j.detail ? `${label}: ${j.detail}` : `${label} failed`;
		});
}

async function runJob(
	phase: ConsolidationPhase,
	name: string,
	fn: () => Promise<unknown>
): Promise<ConsolidationJobResult> {
	const start = Date.now();
	try {
		const detail = await fn();
		return {
			phase,
			job: name,
			ok: true,
			detail:
				typeof detail === 'number'
					? `${detail} items`
					: typeof detail === 'object' && detail !== null && 'repaired' in detail
						? `${(detail as { repaired: number }).repaired} repaired`
						: typeof detail === 'object' && detail !== null && 'deletedEntityKindIds' in detail
							? `${(detail as { deletedEntityKindIds: string[] }).deletedEntityKindIds.length} entity kinds pruned`
							: undefined,
			durationMs: Date.now() - start
		};
	} catch (err) {
		return {
			phase,
			job: name,
			ok: false,
			detail: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - start
		};
	}
}

/**
 * Run all consolidation jobs for a single user (RLS-scoped via {@link withDbUser}).
 */
export async function consolidateForUser(userId: string): Promise<ConsolidationRunResult> {
	return withDbUser(userId, async () => {
		const start = Date.now();
		const jobs: ConsolidationJobResult[] = [];

		// ---- Phase 1: DeepSleep ------------------------------------------------
		jobs.push(
			await runJob('deep_sleep', 'salience_decay', () => runSalienceDecay(userId))
		);

		jobs.push(
			await runJob('deep_sleep', 'ontology_prune', async () => {
				const pruned = await pruneUnusedOntologyEntityKinds(getDb(), userId);
				return pruned;
			})
		);

		jobs.push(
			await runJob('deep_sleep', 'repair_canonical_entity_types', () =>
				repairCanonicalEntityTypesForUser(userId)
			)
		);

		// ---- Phase 2: REM --------------------------------------------------------
		const shouldDetect = await shouldRunCommunityDetection(userId).catch(() => false);
		if (shouldDetect) {
			const detectionResult = await runJob('rem', 'community_detection', () =>
				runCommunityDetection(userId).then((r) => r.totalCommunities)
			);
			jobs.push(detectionResult);

			if (detectionResult.ok) {
				jobs.push(
					await runJob('rem', 'community_summaries', () => runCommunitySummaryGeneration(userId))
				);
			}
		} else {
			jobs.push(
				await runJob('rem', 'community_summaries', () => runCommunitySummaryGeneration(userId))
			);
		}

		jobs.push(
			await runJob('rem', 'open_loop_salience', () => boostOpenLoopSalience(userId))
		);

		return { userId, jobs, totalDurationMs: Date.now() - start };
	});
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
				jobs: result.jobs.map((j) => `${j.phase}/${j.job}:${j.ok ? 'ok' : 'err'}`).join(','),
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

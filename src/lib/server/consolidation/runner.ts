/**
 * Consolidation runner — nightly "sleep" for memory maintenance.
 *
 * Phase 1 (DeepSleep): salience recompute (elapsed-time), ontology prune, entity repair.
 * Phase 2 (REM): integration — community detection/summaries.
 *
 * Salience decay/open-loop floors use wall-clock elapsed time (idempotent per run).
 * Retrieval still bumps salience on access (reconsolidation).
 * Called by POST /api/admin/consolidate (pg_cron at 2am or manual).
 */

import { eq } from 'drizzle-orm';
import { getDb, withDbUser } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { pruneUnusedOntologyEntityKinds } from '$lib/server/ontology-db';
import {
	consolidateCanonicalEntityAliasesForUser,
	repairCanonicalEntityTypesForUser
} from '$lib/server/memory/canonical-entity-admin';
import { runSalienceCompute } from './compute-salience';
import { repairEntityRelationsForUser } from './repair-entity-relations';
import { runCommunityDetection } from './community-detection';
import { runCommunitySummaryGeneration, getCommunitySummaryStats, type CommunitySummaryResult } from './community-summaries';
import { buildAllCommunityBundles } from './community-bundles';
import { computeThoughtRetrievalFeatures } from './thought-retrieval-features';
import { backfillRetrievalLinksForUser } from '$lib/server/retrieval/materialize-links';

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

function formatDurationMs(ms: number): string {
	if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
	return `${ms}ms`;
}

function formatJobResultDetail(detail: unknown): string | undefined {
	if (typeof detail === 'number') {
		return detail === 1 ? '1 item' : `${detail} items`;
	}
	if (typeof detail !== 'object' || detail === null) return undefined;
	if ('repaired' in detail && 'edgesAdded' in detail) {
		const r = detail as {
			repaired: number;
			gaps: number;
			edgesAdded: number;
			scanned?: number;
			processed?: number;
		};
		if (r.gaps === 0) return 'all co-mentioned entities connected';
		const processedDetail =
			typeof r.processed === 'number' ? `, ${r.processed} gap thoughts processed` : '';
		if (r.repaired === 0) return `${r.gaps} gaps found, none repaired yet${processedDetail}`;
		return `${r.repaired} of ${r.gaps} gaps repaired (${r.edgesAdded} edges${processedDetail})`;
	}
	if ('merged' in detail && 'candidates' in detail) {
		const r = detail as { merged: number; candidates: number; scanned: number };
		if (r.candidates === 0) return `no dedup candidates (${r.scanned} scanned)`;
		return `${r.merged} of ${r.candidates} dedup candidates merged (${r.scanned} scanned)`;
	}
	if ('repaired' in detail) {
		return `${(detail as { repaired: number }).repaired} repaired`;
	}
	if ('deletedEntityKindIds' in detail) {
		return `${(detail as { deletedEntityKindIds: string[] }).deletedEntityKindIds.length} entity kinds pruned`;
	}
	if ('totalCommunities' in detail) {
		const r = detail as {
			totalCommunities: number;
			changed?: boolean;
			graphHealth?: { lowConfidence?: boolean; reasons?: string[] };
		};
		const label =
			r.changed === false
				? `${r.totalCommunities} communities (unchanged)`
				: `${r.totalCommunities} communities`;
		if (r.graphHealth?.lowConfidence) {
			const reasons =
				Array.isArray(r.graphHealth.reasons) && r.graphHealth.reasons.length > 0
					? `; low-confidence graph: ${r.graphHealth.reasons.join(', ')}`
					: '; low-confidence graph';
			return `${label}${reasons}`;
		}
		return label;
	}
	if ('summarized' in detail && 'total' in detail) {
		const r = detail as CommunitySummaryResult;
		if (r.total === 0) return 'no communities';
		const base = `${r.summarized} of ${r.total} summarized`;
		if (r.generated > 0) {
			return r.pending > 0
				? `${base} (${r.generated} new, ${r.pending} pending)`
				: `${base} (${r.generated} new)`;
		}
		if (r.pending > 0) return `${base}, ${r.pending} pending`;
		return base;
	}
	if ('generated' in detail) {
		const r = detail as { generated: number; pending?: number };
		if (r.generated > 0) {
			return r.pending && r.pending > 0
				? `${r.generated} summaries written (${r.pending} still pending)`
				: `${r.generated} summaries written`;
		}
		if (r.pending && r.pending > 0) {
			return `${r.pending} communities still need summaries`;
		}
		return 'nothing to summarize';
	}
	if ('decayed' in detail || 'openLoops' in detail) {
		const r = detail as { decayed: number; openLoops: number };
		const parts: string[] = [];
		if (r.decayed > 0) parts.push(`${r.decayed} decayed`);
		if (r.openLoops > 0) parts.push(`${r.openLoops} open loops raised`);
		return parts.length > 0 ? parts.join(', ') : 'nothing to adjust';
	}
	return undefined;
}

/** Human-readable step lines for a completed heartbeat (shown in UI). */
export function formatConsolidationJobSummaries(jobs: ConsolidationJobResult[]): string[] {
	return jobs.map((j) => {
		const label = j.job.replace(/_/g, ' ');
		const timing = formatDurationMs(j.durationMs);
		if (!j.ok) {
			return `${label}: failed (${timing}) — ${j.detail ?? 'unknown error'}`;
		}
		const work = j.detail ?? 'ok';
		return `${label}: ${work} (${timing})`;
	});
}

function jobDetailFromResult(detail: unknown): string | undefined {
	if (typeof detail === 'string' && detail.trim()) return detail;
	return formatJobResultDetail(detail);
}

export type ConsolidateForUserOptions = {
	shouldCancel?: () => boolean | Promise<boolean>;
	onJobStart?: (job: string) => void | Promise<void>;
	onJobComplete?: (result: ConsolidationJobResult) => void | Promise<void>;
};

async function runJob(
	phase: ConsolidationPhase,
	name: string,
	fn: () => Promise<unknown>,
	options?: ConsolidateForUserOptions
): Promise<ConsolidationJobResult> {
	const start = Date.now();
	try {
		await options?.onJobStart?.(name);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[consolidation] job progress update failed on start', { job: name, message });
	}
	try {
		console.info('[consolidation] job executing', { phase, job: name });
		const detail = await fn();
		const result: ConsolidationJobResult = {
			phase,
			job: name,
			ok: true,
			detail: jobDetailFromResult(detail),
			durationMs: Date.now() - start
		};
		try {
			await options?.onJobComplete?.(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[consolidation] job progress update failed on complete', {
				job: name,
				message
			});
		}
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[consolidation] job failed', { phase, job: name, message });
		const result: ConsolidationJobResult = {
			phase,
			job: name,
			ok: false,
			detail: message,
			durationMs: Date.now() - start
		};
		try {
			await options?.onJobComplete?.(result);
		} catch (progressErr) {
			const progressMessage =
				progressErr instanceof Error ? progressErr.message : String(progressErr);
			console.error('[consolidation] job progress update failed after error', {
				job: name,
				message: progressMessage
			});
		}
		return result;
	}
}

async function shouldStop(options?: ConsolidateForUserOptions): Promise<boolean> {
	if (!options?.shouldCancel) return false;
	return options.shouldCancel();
}

/**
 * Run all consolidation jobs for a single user (RLS-scoped via {@link withDbUser}).
 */
export async function consolidateForUser(
	userId: string,
	options?: ConsolidateForUserOptions
): Promise<ConsolidationRunResult> {
	return withDbUser(userId, async () => {
		const start = Date.now();
		const jobs: ConsolidationJobResult[] = [];

		// ---- Phase 1: DeepSleep ------------------------------------------------
		if (await shouldStop(options)) {
			return { userId, jobs, totalDurationMs: Date.now() - start };
		}
		jobs.push(
			await runJob('deep_sleep', 'salience_compute', () => runSalienceCompute(userId), options)
		);

		if (await shouldStop(options)) {
			return { userId, jobs, totalDurationMs: Date.now() - start };
		}
		jobs.push(
			await runJob('deep_sleep', 'ontology_prune', async () => {
				const pruned = await pruneUnusedOntologyEntityKinds(getDb(), userId);
				return pruned;
			}, options)
		);

		if (await shouldStop(options)) {
			return { userId, jobs, totalDurationMs: Date.now() - start };
		}
		jobs.push(
			await runJob('deep_sleep', 'repair_canonical_entity_types', () =>
				repairCanonicalEntityTypesForUser(userId), options)
		);

		if (await shouldStop(options)) {
			return { userId, jobs, totalDurationMs: Date.now() - start };
		}
		jobs.push(
			await runJob('deep_sleep', 'dedup_canonical_entities', () =>
				consolidateCanonicalEntityAliasesForUser(userId), options)
		);

		if (await shouldStop(options)) {
			return { userId, jobs, totalDurationMs: Date.now() - start };
		}
		jobs.push(
			await runJob('deep_sleep', 'repair_entity_relations', () =>
				repairEntityRelationsForUser(userId, { shouldCancel: () => shouldStop(options) }), options)
		);

		// ---- Phase 2: REM --------------------------------------------------------
		if (await shouldStop(options)) {
			return { userId, jobs, totalDurationMs: Date.now() - start };
		}
		let communitiesChanged = true;
		const detectionResult = await runJob('rem', 'community_detection', async () => {
			const result = await runCommunityDetection(userId);
			communitiesChanged = result.changed;
			return result;
		}, options);
		jobs.push(detectionResult);

		if (detectionResult.ok) {
			if (await shouldStop(options)) {
				return { userId, jobs, totalDurationMs: Date.now() - start };
			}
			if (communitiesChanged) {
				jobs.push(await runCommunitySummariesJob(userId, options));
			} else {
				const stats = await getCommunitySummaryStats(userId);
				if (stats.pending > 0) {
					jobs.push(await runCommunitySummariesJob(userId, options));
				} else {
					jobs.push(await skipCommunitySummariesJob(userId, stats, options));
				}
			}

			if (await shouldStop(options)) {
				return { userId, jobs, totalDurationMs: Date.now() - start };
			}
			jobs.push(
				await runJob('rem', 'community_bundles', () => buildAllCommunityBundles(userId), options)
			);
		}

		if (await shouldStop(options)) {
			return { userId, jobs, totalDurationMs: Date.now() - start };
		}
		jobs.push(
			await runJob('rem', 'retrieval_links_backfill', () => backfillRetrievalLinksForUser(userId), options)
		);

		if (await shouldStop(options)) {
			return { userId, jobs, totalDurationMs: Date.now() - start };
		}
		jobs.push(
			await runJob('rem', 'thought_retrieval_features', async () => {
				const updated = await computeThoughtRetrievalFeatures(userId);
				return `${updated} thoughts updated`;
			}, options)
		);

		return { userId, jobs, totalDurationMs: Date.now() - start };
	});
}

async function skipCommunitySummariesJob(
	userId: string,
	stats: { total: number; summarized: number; pending: number },
	options?: ConsolidateForUserOptions
): Promise<ConsolidationJobResult> {
	const start = Date.now();
	const detail =
		stats.total === 0
			? 'skipped (communities unchanged)'
			: `${stats.summarized} of ${stats.total} summarized — skipped (communities unchanged)`;
	try {
		await options?.onJobStart?.('community_summaries');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[consolidation] job progress update failed on start', {
			job: 'community_summaries',
			message
		});
	}
	const result: ConsolidationJobResult = {
		phase: 'rem',
		job: 'community_summaries',
		ok: true,
		detail,
		durationMs: Date.now() - start
	};
	console.info('[consolidation] job skipped', { phase: 'rem', job: 'community_summaries', detail });
	try {
		await options?.onJobComplete?.(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[consolidation] job progress update failed on complete', {
			job: 'community_summaries',
			message
		});
	}
	return result;
}

async function runCommunitySummariesJob(
	userId: string,
	options?: ConsolidateForUserOptions
): Promise<ConsolidationJobResult> {
	const start = Date.now();
	try {
		await options?.onJobStart?.('community_summaries');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[consolidation] job progress update failed on start', {
			job: 'community_summaries',
			message
		});
	}
	try {
		console.info('[consolidation] job executing', { phase: 'rem', job: 'community_summaries' });
		const summaryResult = await runCommunitySummaryGeneration(userId, {
			shouldCancel: () => shouldStop(options)
		});
		const detail = jobDetailFromResult(summaryResult);
		const complete = summaryResult.total === 0 || summaryResult.pending === 0;
		const result: ConsolidationJobResult = {
			phase: 'rem',
			job: 'community_summaries',
			ok: complete,
			detail: complete
				? detail
				: `${detail ?? `${summaryResult.summarized} of ${summaryResult.total} summarized`} — ${summaryResult.pending} still pending`,
			durationMs: Date.now() - start
		};
		if (!complete) {
			console.error('[consolidation] community summaries incomplete', summaryResult);
		}
		try {
			await options?.onJobComplete?.(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[consolidation] job progress update failed on complete', {
				job: 'community_summaries',
				message
			});
		}
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[consolidation] job failed', { phase: 'rem', job: 'community_summaries', message });
		const result: ConsolidationJobResult = {
			phase: 'rem',
			job: 'community_summaries',
			ok: false,
			detail: message,
			durationMs: Date.now() - start
		};
		try {
			await options?.onJobComplete?.(result);
		} catch (progressErr) {
			const progressMessage =
				progressErr instanceof Error ? progressErr.message : String(progressErr);
			console.error('[consolidation] job progress update failed after error', {
				job: 'community_summaries',
				message: progressMessage
			});
		}
		return result;
	}
}

/**
 * Run consolidation for all users (cron entrypoint).
 * Processes users sequentially to avoid overwhelming DB/LLM capacity.
 */
export async function consolidateAllUsers(): Promise<ConsolidationRunResult[]> {
	const db = getDb();
	const users = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.accountKind, 'production'));
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

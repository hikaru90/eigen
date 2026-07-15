import type { HeartbeatJobReport } from './heartbeat-job-report';
import { buildHeartbeatJobReport, catalogForJob } from './heartbeat-job-report';

export type HeartbeatJobResult = {
	job: string;
	ok: boolean;
	detail?: string;
	report?: HeartbeatJobReport;
};

/** Resolve a report for UI expand panels (live job, completed job, or catalog-only). */
export function resolveHeartbeatJobReport(
	jobId: string,
	job?: HeartbeatJobResult | null,
	options?: { liveDetail?: string | null }
): HeartbeatJobReport {
	if (job?.report) return job.report;
	const detail = job?.detail ?? options?.liveDetail ?? undefined;
	if (job || detail) {
		return buildHeartbeatJobReport(jobId, null, {
			ok: job?.ok !== false,
			detail
		});
	}
	const catalog = catalogForJob(jobId);
	return {
		summary: 'Not run yet',
		explanation: catalog.explanation,
		verdict: 'info',
		verdictLabel: 'Waiting'
	};
}

export type HeartbeatRunProgress = {
	plannedJobs: string[];
	jobs: HeartbeatJobResult[];
	currentJob: string | null;
};

export function parseSummaryProgress(
	detail?: string
): { summarized: number; total: number; pending: number; deferred: number } | null {
	if (!detail) return null;
	const counts =
		detail.match(/(\d+) of (\d+) L1 routing summaries/) ??
		detail.match(/(\d+) of (\d+) summarized/);
	if (!counts) return null;
	const summarized = Number(counts[1]);
	const total = Number(counts[2]);
	if (!Number.isFinite(summarized) || !Number.isFinite(total) || total <= 0) return null;
	const pendingMatch = detail.match(/(\d+) pending/);
	const deferredMatch = detail.match(/(\d+) deferred/);
	const pending = pendingMatch ? Number(pendingMatch[1]) : Math.max(0, total - summarized);
	const deferred = deferredMatch ? Number(deferredMatch[1]) : 0;
	return { summarized, total, pending, deferred };
}

function jobResultFor(run: HeartbeatRunProgress, jobId: string): HeartbeatJobResult | undefined {
	return run.jobs.find((j) => j.job === jobId);
}

function countCompletedPlannedJobs(run: HeartbeatRunProgress): number {
	return run.plannedJobs.filter((jobId) => jobResultFor(run, jobId)?.ok === true).length;
}

export function isHeartbeatRunFullyComplete(run: HeartbeatRunProgress): boolean {
	if (run.currentJob) return false;
	for (const jobId of run.plannedJobs) {
		if (jobResultFor(run, jobId)?.ok !== true) return false;
	}
	const summaryJob = jobResultFor(run, 'community_summaries');
	if (summaryJob) {
		const parsed = parseSummaryProgress(summaryJob.detail);
		// Deferred work is intentional budget exhaustion — run completed, resumes next heartbeat.
		if (parsed && parsed.pending > 0 && parsed.deferred === 0 && !summaryJob.detail?.includes('will resume')) {
			return false;
		}
	}
	return true;
}

export function heartbeatProgressPctFromRun(
	run: HeartbeatRunProgress,
	summaryStats?: { summarized: number; total: number } | null,
	options?: { capIncompleteAt99?: boolean }
): number {
	const planned = run.plannedJobs.length;
	if (planned === 0) return 0;

	const completedPlanned = countCompletedPlannedJobs(run);
	const currentJobIncomplete =
		run.currentJob !== null && jobResultFor(run, run.currentJob)?.ok !== true;
	const inFlight = currentJobIncomplete ? 0.5 : 0;
	let pct = ((completedPlanned + inFlight) / planned) * 100;

	const summariesJobIndex = run.plannedJobs.indexOf('community_summaries');
	if (summariesJobIndex >= 0) {
		if (run.currentJob === 'community_summaries' && summaryStats && summaryStats.total > 0) {
			pct =
				((summariesJobIndex + summaryStats.summarized / summaryStats.total) / planned) * 100;
		} else if (!run.currentJob || run.currentJob !== 'community_summaries') {
			const summaryJob = jobResultFor(run, 'community_summaries');
			const hasSummaryResult = summaryJob !== undefined;
			if (hasSummaryResult) {
				const parsed = parseSummaryProgress(summaryJob.detail);
				if (parsed && parsed.total > 0) {
					pct =
						((summariesJobIndex + parsed.summarized / parsed.total) / planned) * 100;
				}
			}
		}
	}

	const rounded = Math.round(pct);
	if (options?.capIncompleteAt99 && !isHeartbeatRunFullyComplete(run)) {
		return Math.min(99, rounded);
	}
	if (!isHeartbeatRunFullyComplete(run)) {
		return Math.min(100, rounded);
	}
	return 100;
}

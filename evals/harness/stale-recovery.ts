import {
	appendEvalEvent,
	listEvalEntries,
	loadEvalRunDetail,
	updateEvalEntry,
	updateEvalRunStatus
} from '$lib/eval/store';

/**
 * Mark runs failed when DB says `running` but this process has no active runner
 * (dev server reload, crash, or hung step). Poll GET triggers this so the UI unblocks.
 */
export async function recoverOrphanedEvalRun(
	operatorUserId: string,
	runId: string,
	activeRunId: string | null
): Promise<boolean> {
	if (activeRunId === runId) return false;

	const detail = await loadEvalRunDetail(operatorUserId, runId);
	if (!detail || detail.run.status !== 'running') return false;

	const entries = await listEvalEntries(operatorUserId, runId);

	for (const entry of entries) {
		if (entry.status === 'running' || entry.status === 'pending') {
			await updateEvalEntry(operatorUserId, entry.id, {
				status: 'failed',
				passed: false,
				error:
					entry.status === 'running'
						? 'Eval runner stopped while this step was in progress (dev reload or crash). Start a new run.'
						: 'Run aborted before this step started.',
				finishedAt: new Date()
			});
		}
	}

	await updateEvalRunStatus(operatorUserId, runId, {
		status: 'failed',
		finishedAt: new Date(),
		error: 'Run orphaned — no active eval runner. Start a new run.'
	});
	await appendEvalEvent({
		operatorUserId,
		runId,
		level: 'error',
		message: 'run recovered as failed (no in-process runner)'
	});

	return true;
}

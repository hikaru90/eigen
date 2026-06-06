/** In-process stop requests for the active eval runner (dev `/eval` UI). */

const stopRequestedRunIds = new Set<string>();

export function requestEvalRunStop(runId: string): void {
	stopRequestedRunIds.add(runId);
}

export function isEvalRunStopRequested(runId: string): boolean {
	return stopRequestedRunIds.has(runId);
}

export function clearEvalRunStopRequest(runId: string): void {
	stopRequestedRunIds.delete(runId);
}

export class EvalRunStoppedError extends Error {
	constructor(runId: string) {
		super(`Eval run stopped: ${runId}`);
		this.name = 'EvalRunStoppedError';
	}
}

export function assertEvalRunNotStopped(runId: string): void {
	if (isEvalRunStopRequested(runId)) {
		throw new EvalRunStoppedError(runId);
	}
}

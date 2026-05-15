import type { ChildProcess } from 'node:child_process';

interface EvalState {
	startedAt: Date | null;
	pid: number | null;
	proc: ChildProcess | null;
	logs: string[];
	status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
}

const evalState: EvalState = {
	startedAt: null,
	pid: null,
	proc: null,
	logs: [],
	status: 'idle'
};

export function getEvalState() {
	return evalState;
}

export function setEvalProc(proc: ChildProcess) {
	evalState.proc = proc;
	evalState.pid = proc.pid ?? null;
	evalState.startedAt = new Date();
	evalState.status = 'running';
	evalState.logs = [];
}

export function appendEvalLog(line: string) {
	evalState.logs.push(line);
}

export function setEvalStatus(status: EvalState['status']) {
	evalState.status = status;
}

export function resetEvalState() {
	evalState.proc = null;
	evalState.pid = null;
	evalState.startedAt = null;
	evalState.status = 'idle';
}
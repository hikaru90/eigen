import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { dev } from '$app/environment';
import {
	getEvalState,
	setEvalProc,
	appendEvalLog,
	setEvalStatus,
	resetEvalState
} from '$lib/server/eval-state';

export const POST: RequestHandler = async ({ request }) => {
	if (!dev) {
		return json({ error: 'Eval endpoint only available in dev mode' }, { status: 403 });
	}

	const state = getEvalState();
	if (state.status === 'running') {
		return json({ error: 'Evaluation already running', pid: state.pid }, { status: 409 });
	}

	// Parse optional mode from request body (defaults to 'full')
	let mode = 'full';
	try {
		const body = await request.json().catch(() => ({}));
		if (body.mode === 'analysis-only') mode = 'analysis-only';
	} catch {
		// ignore parse errors
	}

	resetEvalState();

	const scriptPath = resolve(process.cwd(), 'evals/run.ts');
	const args = ['vite-node', '--config', 'evals/vite.config.ts', scriptPath, '--', '--mode', mode];
	const proc = spawn('npx', args, {
		cwd: process.cwd(),
		stdio: 'pipe'
	});

	setEvalProc(proc);

	proc.stdout.on('data', (data: Buffer) => {
		const text = data.toString();
		appendEvalLog(text);
		console.log(text);
	});

	proc.stderr.on('data', (data: Buffer) => {
		const text = data.toString();
		appendEvalLog(`[stderr] ${text}`);
		console.error(text);
	});

	proc.on('close', (code: number | null) => {
		if (code === 0) {
			setEvalStatus('completed');
		} else if (code === null) {
			setEvalStatus('stopped');
		} else {
			setEvalStatus('failed');
		}
	});

	proc.on('error', (err: Error) => {
		setEvalStatus('failed');
		console.error('Eval process error:', err);
	});

	return json({ success: true, message: 'Evaluation started', pid: proc.pid, mode });
};

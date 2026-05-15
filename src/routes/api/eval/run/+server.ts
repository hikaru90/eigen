import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { dev } from '$app/environment';
import { getEvalState, setEvalProc, appendEvalLog, setEvalStatus, resetEvalState } from '$lib/server/eval-state';

export const POST: RequestHandler = async () => {
  if (!dev) {
    return json({ error: 'Eval endpoint only available in dev mode' }, { status: 403 });
  }

  const state = getEvalState();
  if (state.status === 'running') {
    return json({ error: 'Evaluation already running', pid: state.pid }, { status: 409 });
  }

  resetEvalState();

  return new Promise((resolveResponse) => {
    const scriptPath = resolve(process.cwd(), 'evals/layers/run-all.ts');
    const proc = spawn('npx', ['vite-node', '--config', 'evals/vite.config.ts', scriptPath], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    setEvalProc(proc);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      appendEvalLog(text);
      console.log(text);
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      appendEvalLog(`[stderr] ${text}`);
      console.error(text);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        setEvalStatus('completed');
        resolveResponse(json({ success: true, message: 'Evaluation completed' }));
      } else if (code === null) {
        setEvalStatus('stopped');
        resolveResponse(json({ success: false, error: 'Evaluation stopped' }));
      } else {
        setEvalStatus('failed');
        resolveResponse(json({ success: false, error: `Process exited with code ${code}` }, { status: 500 }));
      }
    });

    proc.on('error', (err) => {
      setEvalStatus('failed');
      console.error('Eval process error:', err);
      resolveResponse(json({ success: false, error: err.message }, { status: 500 }));
    });

    resolveResponse(json({ success: true, message: 'Evaluation started', pid: state.pid }));
  });
};
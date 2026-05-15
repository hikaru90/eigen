import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { getEvalState } from '$lib/server/eval-state';

export const POST: RequestHandler = async () => {
  if (!dev) {
    return json({ error: 'Eval endpoint only available in dev mode' }, { status: 403 });
  }

  const state = getEvalState();
  if (state.status !== 'running' || !state.proc) {
    return json({ error: 'No evaluation running' }, { status: 400 });
  }

  const pid = state.pid;
  state.proc.kill('SIGTERM');

  return json({ success: true, message: `Sent SIGTERM to PID ${pid}` });
};
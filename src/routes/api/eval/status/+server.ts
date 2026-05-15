import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { getEvalState } from '$lib/server/eval-state';

export const GET: RequestHandler = async () => {
  if (!dev) {
    return json({ error: 'Eval endpoint only available in dev mode' }, { status: 403 });
  }

  const state = getEvalState();
  return json({
    status: state.status,
    pid: state.pid,
    startedAt: state.startedAt?.toISOString() ?? null,
    logs: state.logs.join('').slice(-5000)
  });
};
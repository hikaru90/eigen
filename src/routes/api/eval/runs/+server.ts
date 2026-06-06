import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { insertEvalUserRow, listEvalRuns } from '$lib/eval/store';
import { startEvalRun, getActiveEvalRunId, type EvalRunMode } from '$lib/eval/runner';

function devOnly(): Response | null {
	if (!dev) {
		return json({ error: 'Eval API only available in dev mode' }, { status: 403 });
	}
	return null;
}

export const GET: RequestHandler = async ({ locals }) => {
	const blocked = devOnly();
	if (blocked) return blocked;
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const runs = await listEvalRuns(locals.user.id);
	return json({ runs });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const blocked = devOnly();
	if (blocked) return blocked;
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	if (getActiveEvalRunId()) {
		return json({ error: 'Evaluation already running', runId: getActiveEvalRunId() }, { status: 409 });
	}

	let mode: EvalRunMode = 'all';
	let qaId: string | undefined;
	let freshCorpus = false;
	try {
		const body = await request.json();
		if (body.mode === 'all' || body.mode === 'smoke' || body.mode === 'qa') {
			mode = body.mode;
		}
		if (typeof body.qaId === 'string' && body.qaId.trim()) {
			qaId = body.qaId.trim();
		}
		if (body.freshCorpus === true) freshCorpus = true;
	} catch {
		// default all (active catalog questions)
	}

	await insertEvalUserRow(locals.user.id, locals.user.name ?? 'Eval operator');

	const { runId, entries } = await startEvalRun({
		operatorUserId: locals.user.id,
		mode,
		qaId,
		freshCorpus
	});

	return json({ success: true, runId, mode, qaId: qaId ?? null, entries });
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { loadEvalRunDetail } from '$lib/eval/store';
import { getActiveEvalRunId } from '$lib/eval/runner';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!dev) return json({ error: 'Eval API only available in dev mode' }, { status: 403 });
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const detail = await loadEvalRunDetail(locals.user.id, params.id);
	if (!detail) return json({ error: 'Run not found' }, { status: 404 });

	return json({
		...detail,
		active: getActiveEvalRunId() === params.id
	});
};

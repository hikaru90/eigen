import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { deleteEvalQa, loadEvalQa, updateEvalQa, updateEvalQaTags } from '$lib/eval/qa-store';

function devOnly(): Response | null {
	if (!dev) {
		return json({ error: 'Eval API only available in dev mode' }, { status: 403 });
	}
	return null;
}

export const GET: RequestHandler = async ({ params }) => {
	const blocked = devOnly();
	if (blocked) return blocked;

	const item = await loadEvalQa(params.id);
	if (!item) return json({ error: 'Not found' }, { status: 404 });
	return json({ item });
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const blocked = devOnly();
	if (blocked) return blocked;
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	const o = body as Record<string, unknown>;
	const keys = Object.keys(o);
	const tagsOnlyUpdate = keys.length > 0 && keys.every((key) => key === 'tags');
	if (tagsOnlyUpdate) {
		try {
			const item = await updateEvalQaTags(params.id, o.tags);
			return json({ item });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const status = message.includes('not found') ? 404 : 400;
			return json({ error: message }, { status });
		}
	}

	const existing = await loadEvalQa(params.id);
	if (!existing) return json({ error: 'Not found' }, { status: 404 });

	const question = typeof o.question === 'string' ? o.question : existing.question;
	const acceptance = typeof o.acceptance === 'string' ? o.acceptance : existing.acceptance;
	const captures = Array.isArray(o.captures) ? o.captures : existing.captures;
	const retrievalQuery =
		typeof o.retrievalQuery === 'string'
			? o.retrievalQuery
			: o.retrievalQuery === null
				? null
				: existing.retrievalQuery;
	const retrievalRelevant = Array.isArray(o.retrievalRelevant)
		? o.retrievalRelevant
		: existing.retrievalRelevant;
	const tags = Array.isArray(o.tags) ? o.tags : existing.tags;
	const edit =
		o.edit && typeof o.edit === 'object'
			? o.edit
			: o.edit === null
				? null
				: existing.edit;

	if (question.trim().length === 0 || acceptance.trim().length === 0) {
		return json({ error: 'question and acceptance are required' }, { status: 400 });
	}

	let checks: Record<string, unknown> | undefined;
	if (o.checks !== undefined) {
		if (o.checks && typeof o.checks === 'object' && !Array.isArray(o.checks)) {
			checks = o.checks as Record<string, unknown>;
		} else if (typeof o.checks === 'string' && o.checks.trim()) {
			try {
				const parsed = JSON.parse(o.checks.trim()) as unknown;
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					return json({ error: 'checks must be a JSON object' }, { status: 400 });
				}
				checks = parsed as Record<string, unknown>;
			} catch {
				return json({ error: 'checks must be valid JSON' }, { status: 400 });
			}
		} else {
			checks = {};
		}
	}

	try {
		const item = await updateEvalQa(params.id, {
			question,
			acceptance,
			captures,
			retrievalQuery,
			retrievalRelevant,
			tags,
			edit,
			...(checks !== undefined ? { checks } : {})
		});
		return json({ item });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = message.includes('not found') ? 404 : 400;
		return json({ error: message }, { status });
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const blocked = devOnly();
	if (blocked) return blocked;
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		await deleteEvalQa(params.id);
		return json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const status = message.includes('not found') ? 404 : 400;
		return json({ error: message }, { status });
	}
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { createEvalQa, listEvalQa } from '$lib/eval/qa-store';

function devOnly(): Response | null {
	if (!dev) {
		return json({ error: 'Eval API only available in dev mode' }, { status: 403 });
	}
	return null;
}

function parseChecks(raw: unknown): Record<string, unknown> {
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		return raw as Record<string, unknown>;
	}
	if (typeof raw === 'string' && raw.trim()) {
		const parsed = JSON.parse(raw.trim()) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('checks must be a JSON object');
		}
		return parsed as Record<string, unknown>;
	}
	return {};
}

function parseQaBody(body: Record<string, unknown>) {
	const { id, question, acceptance, captures, retrievalQuery, retrievalRelevant, tags, edit, checks } =
		body;
	return {
		id: typeof id === 'string' ? id : undefined,
		question: typeof question === 'string' ? question : '',
		acceptance: typeof acceptance === 'string' ? acceptance : '',
		captures: Array.isArray(captures) ? captures : [],
		retrievalQuery: typeof retrievalQuery === 'string' ? retrievalQuery : null,
		retrievalRelevant: Array.isArray(retrievalRelevant) ? retrievalRelevant : [],
		tags: Array.isArray(tags) ? tags : [],
		edit: edit && typeof edit === 'object' ? edit : null,
		checks: parseChecks(checks)
	};
}

export const GET: RequestHandler = async () => {
	const blocked = devOnly();
	if (blocked) return blocked;
	return json({ items: await listEvalQa() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
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

	const parsed = parseQaBody(body as Record<string, unknown>);

	try {
		const item = await createEvalQa(parsed);
		return json({ item }, { status: 201 });
	} catch (err) {
		const message =
			err instanceof SyntaxError
				? 'checks must be valid JSON'
				: err instanceof Error
					? err.message
					: String(err);
		return json({ error: message }, { status: 400 });
	}
};

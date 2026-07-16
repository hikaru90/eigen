import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createTextFile, listTextFiles, searchTextFiles } from '$lib/server/text-files/service';

function parseLimit(url: URL): number {
	const raw = url.searchParams.get('limit');
	if (!raw) return 20;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 1) error(400, 'limit must be a positive number');
	return Math.min(Math.floor(n), 100);
}

function parseCursor(url: URL): { updatedAt: Date; id: string } | undefined {
	const updatedAtRaw = url.searchParams.get('cursor_updated_at');
	const id = url.searchParams.get('cursor_id')?.trim() ?? '';
	if (!updatedAtRaw && !id) return undefined;
	if (!updatedAtRaw || !id) {
		error(400, 'cursor_updated_at and cursor_id must be provided together');
	}
	const updatedAt = new Date(updatedAtRaw);
	if (Number.isNaN(updatedAt.getTime())) {
		error(400, 'cursor_updated_at must be a valid ISO timestamp');
	}
	return { updatedAt, id };
}

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const query = event.url.searchParams.get('q')?.trim() ?? '';
	const authorLayerKey = event.url.searchParams.get('authorLayerKey');
	if (query) {
		const topK = parseLimit(event.url);
		const results = await searchTextFiles(user.id, {
			query,
			topK,
			authorLayerKey
		});
		return json({ count: results.length, results });
	}

	const files = await listTextFiles(user.id, {
		limit: parseLimit(event.url),
		cursor: parseCursor(event.url),
		authorLayerKey
	});

	return json({ count: files.length, textFiles: files });
};

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const title =
		typeof body === 'object' && body && 'title' in body && typeof body.title === 'string'
			? body.title
			: undefined;
	const rawBody =
		typeof body === 'object' && body && 'body' in body && typeof body.body === 'string'
			? body.body
			: undefined;
	if (!(title?.trim() || rawBody?.trim())) error(400, 'title or body is required');

	try {
		const textFile = await createTextFile(user.id, { title, body: rawBody });
		return json({ textFileId: textFile.id, textFile }, { status: 201 });
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		error(400, message);
	}
};

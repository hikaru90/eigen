import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteTextFile, getTextFile, updateTextFile } from '$lib/server/text-files/service';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const fileId = event.params.fileId?.trim() ?? '';
	if (!fileId) error(400, 'fileId is required');

	const textFile = await getTextFile(user.id, fileId);
	if (!textFile) error(404, 'Text file not found');

	return json({ textFile });
};

export const PATCH: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const fileId = event.params.fileId?.trim() ?? '';
	if (!fileId) error(400, 'fileId is required');

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
	if (title === undefined && rawBody === undefined) {
		error(400, 'title or body is required');
	}

	try {
		const textFile = await updateTextFile(user.id, fileId, { title, body: rawBody });
		if (!textFile) error(404, 'Text file not found');
		return json({ textFile });
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		error(400, message);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const fileId = event.params.fileId?.trim() ?? '';
	if (!fileId) error(400, 'fileId is required');

	const deleted = await deleteTextFile(user.id, fileId);
	if (!deleted) error(404, 'Text file not found');

	return json({ deleted: true, textFileId: fileId });
};

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildThoughtsCsv } from '$lib/server/export/thoughts-csv';

function exportFilename(): string {
	const day = new Date().toISOString().slice(0, 10);
	return `thoughts-export-${day}.csv`;
}

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const body = await buildThoughtsCsv(user.id);

	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${exportFilename()}"`
		}
	});
};

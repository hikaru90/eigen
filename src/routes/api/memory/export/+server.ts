import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildMemoryExportZip } from '$lib/server/export/memory-export';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const { filename, bytes } = await buildMemoryExportZip(user.id);

	return new Response(bytes, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${filename}"`
		}
	});
};

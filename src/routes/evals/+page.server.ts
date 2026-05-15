import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** @deprecated Use `/eval` (merged evaluations surface). */
export const load = (async () => {
	throw redirect(302, '/eval');
}) satisfies PageServerLoad;

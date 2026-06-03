import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	throw redirect(302, locals.user ? '/capture' : '/login');
};

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const eventId = event.url.searchParams.get('event');
	const qs = eventId ? `?event=${encodeURIComponent(eventId)}` : '';
	throw redirect(302, `/memory/timeline${qs}`);
};

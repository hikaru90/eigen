import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listConnectedAgents } from '$lib/server/agents/service';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const agents = await listConnectedAgents(event.locals.user.id);

	return {
		user: event.locals.user,
		agents
	};
};

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	deleteGroundingProfile,
	loadGroundingProfileRow
} from '$lib/server/grounding/profile';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const profile = await loadGroundingProfileRow(event.locals.user.id);

	return {
		profile: profile
			? {
					narrativeSummary: profile.narrativeSummary,
					facets: profile.facets,
					initialCompletedAt: profile.initialCompletedAt?.toISOString() ?? null,
					lastSessionAt: profile.lastSessionAt?.toISOString() ?? null,
					sessionCount: profile.sessionCount
				}
			: null
	};
};

export const actions: Actions = {
	deleteGroundingProfile: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}
		await deleteGroundingProfile(event.locals.user.id);
		return { deleted: true as const };
	}
};

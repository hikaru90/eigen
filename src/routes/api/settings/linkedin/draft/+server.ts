import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { planLinkedInDraft, validateLinkedInProfileUrl } from '$lib/server/linkedin/agent-config';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const profileUrl =
		typeof body === 'object' && body && 'profileUrl' in body
			? String((body as { profileUrl?: unknown }).profileUrl ?? '')
			: '';
	const update =
		typeof body === 'object' && body && 'update' in body
			? String((body as { update?: unknown }).update ?? '')
			: '';

	try {
		const validatedUrl = validateLinkedInProfileUrl(profileUrl);
		const draft = planLinkedInDraft({
			config: {
				profileUrl: validatedUrl,
				topics: ['Eigen'],
				enabled: true
			},
			update
		});
		return json({ draft });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		error(400, msg);
	}
};

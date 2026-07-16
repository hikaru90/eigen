import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ONBOARDING_GROUNDING_PUSH_DELAY_MS } from '$lib/grounding/onboarding-welcome-constants';
import { scheduleOnboardingGroundingPush } from '$lib/server/grounding/onboarding-welcome-push';

/**
 * Schedule the first grounding question push after PWA install during onboarding.
 * Body: `{ delayMs?: number }` — remaining ms until send (default 30s).
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let delayMs = ONBOARDING_GROUNDING_PUSH_DELAY_MS;
	try {
		const body = await event.request.json().catch(() => null);
		if (body && typeof body === 'object' && 'delayMs' in body) {
			const raw = (body as { delayMs?: unknown }).delayMs;
			if (typeof raw === 'number' && Number.isFinite(raw)) {
				delayMs = raw;
			}
		}
	} catch {
		// empty / invalid body → default delay
	}

	try {
		const result = await scheduleOnboardingGroundingPush({
			userId: user.id,
			delayMs
		});
		return json({ ok: true as const, ...result });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes('VAPID_') || msg.includes('VAPID')) {
			error(503, msg);
		}
		error(500, msg);
	}
};

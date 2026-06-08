import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate';
import { isByokBilling } from '$lib/server/billing/preferences';
import { getWalletSnapshot } from '$lib/server/billing/wallet';
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits';
import {
	isInitialGroundingComplete,
	loadGroundingProfileRow
} from '$lib/server/grounding/profile';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const userId = event.locals.user.id;
	const [gate, byok, wallet, grounding] = await Promise.all([
		checkCaptureAllowed(userId),
		isByokBilling(userId),
		getWalletSnapshot(userId),
		loadGroundingProfileRow(userId)
	]);

	return {
		captureGate: gate,
		billingMode: byok ? ('byok' as const) : ('platform_credits' as const),
		walletAvailableCredits: wallet.availableCredits,
		minCaptureCredits: MIN_CAPTURE_PIPELINE_CREDITS,
		groundingCompleted: isInitialGroundingComplete(grounding),
		groundingProfile: grounding
			? {
					facetKeys: Object.keys(grounding.facets),
					sessionCount: grounding.sessionCount,
					lastSessionAt: grounding.lastSessionAt?.toISOString() ?? null
				}
			: null
	};
};

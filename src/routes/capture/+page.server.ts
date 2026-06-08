import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authDb } from '$lib/server/db/auth-db';
import { user } from '$lib/server/db/auth.schema';
import { getDb } from '$lib/server/db';
import { userPreference } from '$lib/server/db/schema';
import { ensureUserOntologySeeded } from '$lib/server/ontology-db';
import { loadRecentCaptureThoughts } from '$lib/server/capture/load-recent-capture-thoughts';
import { eq } from 'drizzle-orm';
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate';
import { getOrCreateWallet } from '$lib/server/billing/wallet';
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits';
import { getPayPalClientId, getPayPalWebSdkUrl, getPayPalClientSecret } from '$lib/server/billing/paypal';
import {
	isInitialGroundingComplete,
	loadGroundingProfileRow
} from '$lib/server/grounding/profile';
import { shouldShowRegroundNudge } from '$lib/server/grounding/nudge';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}
	const userId = event.locals.user.id;
	await ensureUserOntologySeeded(getDb(), userId);

	const [pref, authUser, captureGate, wallet, grounding] = await Promise.all([
		getDb()
			.select({ preferredLanguage: userPreference.preferredLanguage, billingMode: userPreference.billingMode })
			.from(userPreference)
			.where(eq(userPreference.userId, userId))
			.limit(1)
			.then((rows) => rows[0]),
		authDb
			.select({ onboardingCompleted: user.onboardingCompleted })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1)
			.then((rows) => rows[0]),
		checkCaptureAllowed(userId),
		getOrCreateWallet(userId),
		loadGroundingProfileRow(userId)
	]);

	let paypalConfigured = false;
	let paypalClientId: string | null = null;
	let paypalSdkUrl: string | null = null;
	try {
		paypalClientId = getPayPalClientId();
		paypalSdkUrl = getPayPalWebSdkUrl();
		getPayPalClientSecret();
		paypalConfigured = true;
	} catch {
		paypalConfigured = false;
	}

	const billingMode = (pref?.billingMode ?? 'platform_credits') as 'platform_credits' | 'byok';
	const groundingCompleted = isInitialGroundingComplete(grounding);
	const creditsGatePassed =
		billingMode === 'byok' || wallet.availableCredits >= MIN_CAPTURE_PIPELINE_CREDITS;

	const regroundDismissed =
		event.cookies.get('eigen_reground_dismissed') === '1';
	const showRegroundNudge = await shouldShowRegroundNudge({
		userId,
		grounding,
		dismissed: regroundDismissed
	});

	const { recentThoughts, recentThoughtDetails } = await loadRecentCaptureThoughts(userId);

	return {
		user: event.locals.user,
		onboardingCompleted: authUser?.onboardingCompleted === true,
		preferredLanguage: pref?.preferredLanguage ?? 'en',
		billingMode,
		walletAvailableCredits: wallet.availableCredits,
		minCaptureCredits: MIN_CAPTURE_PIPELINE_CREDITS,
		paypalConfigured,
		paypalClientId,
		paypalSdkUrl,
		groundingCompleted,
		creditsGatePassed,
		captureAllowed: captureGate.allowed,
		captureGateReason: captureGate.allowed ? null : captureGate.reason,
		showRegroundNudge,
		recentThoughts,
		recentThoughtDetails
	};
};

export const actions: Actions = {
	completeOnboarding: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const gate = await checkCaptureAllowed(event.locals.user.id);
		if (!gate.allowed) {
			return fail(400, {
				message:
					gate.reason === 'grounding_required'
						? 'Complete the grounding conversation before finishing onboarding.'
						: 'Add credits before finishing onboarding.'
			});
		}

		await authDb
			.update(user)
			.set({ onboardingCompleted: true })
			.where(eq(user.id, event.locals.user.id));

		return { ok: true as const };
	},

	dismissRegroundNudge: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}
		event.cookies.set('eigen_reground_dismissed', '1', {
			path: '/',
			maxAge: 60 * 60 * 24 * 30,
			httpOnly: true,
			sameSite: 'lax'
		});
		return { dismissed: true as const };
	}
};

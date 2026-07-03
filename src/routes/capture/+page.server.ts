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
import {
	getPayPalClientId,
	getPayPalWebSdkUrl,
	isPayPalConfigured
} from '$lib/server/billing/paypal';
import { isByokUiEnabled } from '$lib/server/billing/byok-ui';
import { isGroundingQuestionDue } from '$lib/server/grounding/question-due';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}
	const userId = event.locals.user.id;
	await ensureUserOntologySeeded(getDb(), userId);

	const [pref, authUser, captureGate, wallet, groundingQuestionEligible] = await Promise.all([
		getDb()
			.select({ preferredLanguage: userPreference.preferredLanguage, billingMode: userPreference.billingMode })
			.from(userPreference)
			.where(eq(userPreference.userId, userId))
			.limit(1)
			.then((rows) => rows[0]),
		authDb
			.select({ onboardingCompleted: user.onboardingCompleted, accountKind: user.accountKind })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1)
			.then((rows) => rows[0]),
		checkCaptureAllowed(userId),
		getOrCreateWallet(userId),
		isGroundingQuestionDue(userId)
	]);

	const paypalConfigured = isPayPalConfigured();
	const byokUiEnabled = isByokUiEnabled();
	const paypalClientId = paypalConfigured ? getPayPalClientId() : null;
	const paypalSdkUrl = paypalConfigured ? getPayPalWebSdkUrl() : null;

	const isHarness = authUser?.accountKind === 'harness';

	const billingMode = (pref?.billingMode ?? 'platform_credits') as 'platform_credits' | 'byok';
	const creditsGatePassed =
		isHarness ||
		billingMode === 'byok' ||
		wallet.availableCredits >= MIN_CAPTURE_PIPELINE_CREDITS;

	const { recentThoughts, recentThoughtDetails } = await loadRecentCaptureThoughts(userId);

	return {
		user: event.locals.user,
		isHarness,
		onboardingCompleted: isHarness || authUser?.onboardingCompleted === true,
		preferredLanguage: pref?.preferredLanguage ?? 'en',
		billingMode,
		walletAvailableCredits: wallet.availableCredits,
		minCaptureCredits: MIN_CAPTURE_PIPELINE_CREDITS,
		paypalConfigured,
		paypalClientId,
		paypalSdkUrl,
		byokUiEnabled,
		creditsGatePassed,
		captureAllowed: captureGate.allowed,
		captureGateReason: captureGate.allowed ? null : captureGate.reason,
		groundingQuestionEligible,
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
				message: 'Add credits before finishing onboarding.'
			});
		}

		await authDb
			.update(user)
			.set({ onboardingCompleted: true })
			.where(eq(user.id, event.locals.user.id));

		return { ok: true as const };
	},

	skipOnboarding: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		await authDb
			.update(user)
			.set({ onboardingCompleted: true })
			.where(eq(user.id, event.locals.user.id));

		return { ok: true as const };
	}
};

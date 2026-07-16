import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { getSafeErrorMessage } from '$lib/server/auth-form-errors';
import { signUpSchema } from '$lib/validation/auth';
import { env } from '$env/dynamic/private';
import { listEnabledSocialProviderIds } from '$lib/server/auth-social';
import { parseSignupPlanParam } from '$lib/auth/signup-plan';
import { isUseSendMailConfigured } from '$lib/server/email/usesend';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		throw redirect(302, '/capture');
	}

	const rawPlan = event.url.searchParams.get('plan');
	if (rawPlan !== null && parseSignupPlanParam(rawPlan) === null) {
		throw error(400, 'Invalid plan parameter. Use managed or self-hosted.');
	}

	const plan = parseSignupPlanParam(rawPlan);

	return {
		socialProviders: listEnabledSocialProviderIds(env),
		plan,
		emailVerificationRequired: isUseSendMailConfigured(env)
	};
};

export const actions: Actions = {
	signUpEmail: async (event) => {
		const formData = await event.request.formData();
		const name = formData.get('name')?.toString()?.trim() ?? '';
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		const validation = signUpSchema.safeParse({ name, email, password });
		if (!validation.success) {
			const fieldErrors = validation.error.flatten().fieldErrors;
			const message =
				fieldErrors.name?.[0] || fieldErrors.email?.[0] || fieldErrors.password?.[0] || 'Registration failed';
			return fail(400, { message });
		}

		const emailVerificationRequired = isUseSendMailConfigured(env);

		try {
			await auth.api.signUpEmail({
				body: {
					name: validation.data.name,
					email: validation.data.email,
					password: validation.data.password,
					callbackURL: '/capture'
				}
			});
		} catch (error) {
			const safeMessage = getSafeErrorMessage(error, 'Registration failed');
			return fail(400, { message: safeMessage });
		}

		if (emailVerificationRequired) {
			return {
				checkEmail: true,
				message: 'Check your email for a verification link before signing in.'
			};
		}

		throw redirect(302, '/capture');
	}
};

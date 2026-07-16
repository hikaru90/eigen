import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { getSafeErrorMessage } from '$lib/server/auth-form-errors';
import { signInSchema } from '$lib/validation/auth';
import { env } from '$env/dynamic/private';
import { listEnabledSocialProviderIds } from '$lib/server/auth-social';

function isEmailNotVerifiedError(error: unknown): boolean {
	return getSafeErrorMessage(error, '') === 'Email not verified';
}

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		throw redirect(302, '/capture');
	}
	const oauthError = event.url.searchParams.get('error');
	return {
		socialProviders: listEnabledSocialProviderIds(env),
		oauthError: oauthError?.trim() || null
	};
};

export const actions: Actions = {
	signInEmail: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		const validation = signInSchema.safeParse({ email, password });
		if (!validation.success) {
			const fieldErrors = validation.error.flatten().fieldErrors;
			const message = fieldErrors.email?.[0] || fieldErrors.password?.[0] || 'Invalid credentials';
			return fail(400, { message });
		}

		try {
			await auth.api.signInEmail({
				body: {
					email: validation.data.email,
					password: validation.data.password,
					rememberMe: true,
					callbackURL: '/capture'
				}
			});
		} catch (error) {
			if (isEmailNotVerifiedError(error)) {
				return fail(403, {
					message:
						'Email not verified. Check your inbox for a verification link (a new one was sent if mail is configured).'
				});
			}
			const safeMessage = getSafeErrorMessage(error, 'Sign in failed');
			return fail(401, { message: safeMessage });
		}

		throw redirect(302, '/capture');
	}
};

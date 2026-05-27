import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { getSafeErrorMessage } from '$lib/server/auth-form-errors';
import { env } from '$env/dynamic/private';
import { listEnabledSocialProviderIds } from '$lib/server/auth-social';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		throw redirect(302, '/capture');
	}
	return { socialProviders: listEnabledSocialProviderIds(env) };
};

export const actions: Actions = {
	signUpEmail: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';
		const name = formData.get('name')?.toString() ?? '';

		try {
			await auth.api.signUpEmail({
				body: {
					email,
					password,
					name,
					rememberMe: true
				}
			});
		} catch (error) {
			return fail(400, { message: getSafeErrorMessage(error, 'Registration failed') });
		}

		throw redirect(302, '/capture');
	}
};

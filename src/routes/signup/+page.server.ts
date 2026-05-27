import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { getSafeErrorMessage } from '$lib/server/auth-form-errors';
import { signUpSchema } from '$lib/validation/auth';
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

		try {
			await auth.api.signUpEmail({
				body: {
					name: validation.data.name,
					email: validation.data.email,
					password: validation.data.password
				}
			});
		} catch (error) {
			const safeMessage = getSafeErrorMessage(error, 'Registration failed');
			return fail(400, { message: safeMessage });
		}

		throw redirect(302, '/capture');
	}
};

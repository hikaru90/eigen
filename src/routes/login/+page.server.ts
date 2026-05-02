import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { getSafeErrorMessage } from '$lib/server/auth-form-errors';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		throw redirect(302, '/capture');
	}
	return {};
};

export const actions: Actions = {
	signInEmail: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		try {
			await auth.api.signInEmail({
				body: { email, password, rememberMe: true }
			});
		} catch (error) {
			return fail(400, { message: getSafeErrorMessage(error, 'Sign in failed') });
		}

		throw redirect(302, '/capture');
	}
};

import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import type { PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';

const getSafeErrorMessage = (error: unknown, fallback: string) => {
	if (error instanceof APIError) {
		return error.message || fallback;
	}

	if (error instanceof Error) {
		// Keep user-facing errors concise while still surfacing useful backend failures.
		return error.message || fallback;
	}

	if (typeof error === 'object' && error !== null && 'message' in error) {
		const msg = (error as { message?: unknown }).message;
		return typeof msg === 'string' && msg.trim().length > 0 ? msg : fallback;
	}

	return fallback;
};

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		throw redirect(302, '/demo/better-auth');
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
				body: {
					email,
					password,
					callbackURL: '/auth/verification-success'
				}
			});
		} catch (error) {
			return fail(400, { message: getSafeErrorMessage(error, 'Signin failed') });
		}

		throw redirect(302, '/demo/better-auth');
	},
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
					callbackURL: '/auth/verification-success'
				}
			});
		} catch (error) {
			return fail(400, { message: getSafeErrorMessage(error, 'Registration failed') });
		}

		throw redirect(302, '/demo/better-auth');
	},
};

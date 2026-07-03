import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { authDb } from '$lib/server/db/auth-db';
import { buildSocialProvidersConfig, listEnabledSocialProviderIds } from '$lib/server/auth-social';
import { resolveAccountKindForNewUser } from '$lib/auth/account-kind';

const socialProviders = buildSocialProvidersConfig(env);
const enabledSocialProviderIds = listEnabledSocialProviderIds(env);

/**
 * Better Auth requires an absolute URL with a scheme. Some hosts set `ORIGIN` to a bare hostname
 * (e.g. `app.example.com`), which `new URL` rejects until `https://` is prepended.
 */
export function normalizeAuthOrigin(raw: string | undefined): string {
	const trimmed = raw?.trim();
	if (!trimmed) {
		throw new Error('ORIGIN is not set (required for Better Auth baseURL)');
	}
	const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		throw new Error(`ORIGIN is not a valid URL: "${trimmed}"`);
	}
	return url.href.replace(/\/$/, '');
}

export const auth = betterAuth({
	baseURL: normalizeAuthOrigin(env.ORIGIN),
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(authDb, { provider: 'pg' }),
	emailAndPassword: { enabled: true },
	...(enabledSocialProviderIds.length > 0
		? {
				socialProviders,
				account: {
					accountLinking: {
						enabled: true,
						trustedProviders: enabledSocialProviderIds
					}
				}
			}
		: {}),
	user: {
		additionalFields: {
			onboardingCompleted: {
				type: 'boolean',
				required: false,
				defaultValue: false,
				input: false,
				returned: true
			},
			role: {
				type: 'string',
				required: false,
				defaultValue: 'user',
				input: false,
				returned: true
			},
			accountKind: {
				type: 'string',
				required: false,
				defaultValue: 'production',
				input: false,
				returned: false
			}
		}
	},
	databaseHooks: {
		user: {
			create: {
				before: async (user) => ({
					data: {
						...user,
						accountKind: resolveAccountKindForNewUser(String(user.email ?? ''))
					}
				}),
				after: async (user) => {
					// Give every new user 100 starting credits so capture works out of the box.
					try {
						const { userWallet } = await import('$lib/server/db/schema');
						const { eq } = await import('drizzle-orm');
						const existing = await authDb
							.select()
							.from(userWallet)
							.where(eq(userWallet.userId, user.id))
							.limit(1);
						if (existing.length === 0) {
							await authDb.insert(userWallet).values({
								userId: user.id,
								availableCredits: 100,
								reservedCredits: 0,
								pendingBillingMicroUsd: 0,
								currency: 'USD'
							});
						}
					} catch {
						// Non-critical
					}
				}
			}
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});

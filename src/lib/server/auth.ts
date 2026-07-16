import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { authDb } from '$lib/server/db/auth-db';
import { buildSocialProvidersConfig, listEnabledSocialProviderIds } from '$lib/server/auth-social';
import { resolveAccountKindForNewUser } from '$lib/auth/account-kind';
import { isUseSendMailConfigured, sendTransactionalEmail } from '$lib/server/email/usesend';
import { recordVerificationLink } from '$lib/server/e2e/verification-link-store';

const socialProviders = buildSocialProvidersConfig(env);
const enabledSocialProviderIds = listEnabledSocialProviderIds(env);
const mailConfigured = isUseSendMailConfigured(env);

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

function linkEmailHtml(label: string, url: string): string {
	const escaped = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
	return `<p>${label}</p><p><a href="${escaped}">${escaped}</a></p>`;
}

function queueTransactionalEmail(input: {
	to: string;
	subject: string;
	html: string;
	text: string;
}): void {
	void sendTransactionalEmail(env, input).catch((err) => {
		console.error('[auth] transactional email failed', {
			to: input.to,
			subject: input.subject,
			error: err instanceof Error ? err.message : String(err)
		});
	});
}

export const auth = betterAuth({
	baseURL: normalizeAuthOrigin(env.ORIGIN),
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(authDb, { provider: 'pg' }),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: mailConfigured,
		...(mailConfigured
			? {
					sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
						queueTransactionalEmail({
							to: user.email,
							subject: 'Reset your Eigen password',
							text: `Click the link to reset your password:\n${url}`,
							html: linkEmailHtml('Click the link to reset your password:', url)
						});
					}
				}
			: {})
	},
	...(mailConfigured
		? {
				emailVerification: {
					sendOnSignUp: true,
					sendOnSignIn: true,
					autoSignInAfterVerification: true,
					sendVerificationEmail: async ({
						user,
						url
					}: {
						user: { email: string };
						url: string;
					}) => {
						recordVerificationLink(user.email, url);
						queueTransactionalEmail({
							to: user.email,
							subject: 'Verify your Eigen email',
							text: `Click the link to verify your email:\n${url}`,
							html: linkEmailHtml('Click the link to verify your email:', url)
						});
					}
				}
			}
		: {}),
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
		changeEmail: {
			enabled: true,
			/** Without a mailer, allow immediate updates; with useSend, confirm via email. */
			updateEmailWithoutVerification: !mailConfigured,
			...(mailConfigured
				? {
						sendChangeEmailConfirmation: async ({
							user,
							newEmail,
							url
						}: {
							user: { email: string };
							newEmail: string;
							url: string;
						}) => {
							queueTransactionalEmail({
								to: user.email,
								subject: 'Confirm your Eigen email change',
								text: `Confirm changing your email to ${newEmail}:\n${url}`,
								html: linkEmailHtml(
									`Confirm changing your email to <strong>${newEmail.replace(/</g, '&lt;')}</strong>:`,
									url
								)
							});
						}
					}
				: {})
		},
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
					const { grantStartingFreeCredits } = await import('$lib/server/billing/wallet');
					try {
						await grantStartingFreeCredits(user.id);
					} catch (err) {
						console.error('[auth] failed to grant starting free credits', {
							userId: user.id,
							error: err instanceof Error ? err.message : String(err)
						});
					}
				}
			}
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});

import { env } from '$env/dynamic/private';

/** When false (default), BYOK settings UI is hidden; server BYOK paths remain for self-host. */
export function isByokUiEnabled(): boolean {
	return env.BILLING_BYOK_UI_ENABLED?.trim().toLowerCase() === 'true';
}

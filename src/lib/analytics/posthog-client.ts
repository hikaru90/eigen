import { browser } from '$app/environment';
import posthog from 'posthog-js';

const DEFAULT_EU_API_HOST = 'https://eu.i.posthog.com';
const DEFAULT_EU_UI_HOST = 'https://eu.posthog.com';

let initialized = false;

function posthogKey(): string | undefined {
	const key = import.meta.env.PUBLIC_POSTHOG_KEY?.trim();
	return key || undefined;
}

function posthogApiHost(): string {
	const host = import.meta.env.PUBLIC_POSTHOG_HOST?.trim();
	return host || DEFAULT_EU_API_HOST;
}

function posthogUiHost(): string {
	const apiHost = posthogApiHost();
	if (apiHost.includes('eu.')) return DEFAULT_EU_UI_HOST;
	return 'https://us.posthog.com';
}

function ensureInit(): boolean {
	if (!browser) return false;
	if (initialized) return true;
	const key = posthogKey();
	if (!key) return false;
	posthog.init(key, {
		api_host: '/ingest',
		ui_host: posthogUiHost(),
		defaults: '2026-01-30',
		person_profiles: 'identified_only',
		capture_pageview: false,
		capture_exceptions: true
	});
	initialized = true;
	return true;
}

export function isPostHogEnabled(): boolean {
	return browser && Boolean(posthogKey());
}

export function initPostHog(): boolean {
	return ensureInit();
}

export function capture(event: string, properties?: Record<string, unknown>): void {
	if (!ensureInit()) return;
	posthog.capture(event, properties);
}

export function identify(userId: string, traits?: Record<string, unknown>): void {
	if (!ensureInit()) return;
	posthog.identify(userId, traits);
}

export function resetPostHog(): void {
	if (!browser || !initialized) return;
	posthog.reset();
}

export function capturePageview(path: string): void {
	if (!ensureInit()) return;
	posthog.capture('$pageview', { $current_url: path });
}

export function captureClientException(
	error: unknown,
	properties?: Record<string, unknown>
): void {
	if (!ensureInit()) return;
	posthog.captureException(error, properties);
}

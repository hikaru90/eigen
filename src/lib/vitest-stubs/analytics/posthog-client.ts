/**
 * Browser-mode stub for `$lib/analytics/posthog-client`.
 *
 * The real module pulls `posthog-js` and `$env/dynamic/public`, neither of which
 * exists in the lean `vitest.browser.config.ts` setup. Component specs that render
 * chrome containing the You menu never sign out, so the analytics reset is a no-op.
 */
export function resetPostHog(): void {}

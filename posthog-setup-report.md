<wizard-report>
# PostHog post-wizard report

The wizard completed a deep integration of PostHog analytics into the Eigen SvelteKit application. The project already had a solid foundation (custom wrappers, billing events, user identification, error tracking) — this run layered on the reverse proxy, session-replay config, new capture lifecycle events, and the onboarding completion event.

## Changes made

| File | Change |
|------|--------|
| `src/hooks.server.ts` | Added `handlePostHogProxy` handler that routes `/ingest/*` requests to EU PostHog servers (`eu.i.posthog.com` / `eu-assets.i.posthog.com`) to avoid ad blockers; added to `sequence()` first |
| `src/lib/analytics/posthog-client.ts` | Changed `api_host` from direct PostHog URL to `/ingest` (uses the new proxy); added `capture_exceptions: true` for automatic client-side error capture |
| `svelte.config.js` | Added `paths: { relative: false }` — required for PostHog session replay to work correctly with SSR |
| `.env` | Added `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST`, and `POSTHOG_API_KEY` with the EU PostHog project credentials |
| `src/routes/capture/+page.svelte` | Added `capture_submitted`, `capture_completed`, `capture_failed`, `thought_deleted`, and `thought_edit_submitted` events tracking core capture lifecycle |
| `src/lib/components/capture-onboarding-overlay.svelte` | Added `onboarding_completed` event fired when the user finishes the onboarding overlay |

## Events tracked

| Event | Description | File |
|-------|-------------|------|
| `capture_submitted` | User submits a new thought for capture and enrichment | `src/routes/capture/+page.svelte` |
| `capture_completed` | A capture successfully completes enrichment | `src/routes/capture/+page.svelte` |
| `capture_failed` | A capture fails during processing | `src/routes/capture/+page.svelte` |
| `thought_deleted` | User confirms deletion of an existing thought | `src/routes/capture/+page.svelte` |
| `thought_edit_submitted` | User submits an edit request for an existing thought | `src/routes/capture/+page.svelte` |
| `onboarding_completed` | User completes the onboarding overlay | `src/lib/components/capture-onboarding-overlay.svelte` |

Previously existing events (not modified):

| Event | File |
|-------|------|
| `billing_checkout_started` / `billing_checkout_completed` / `billing_checkout_capture_failed` | `src/lib/billing/paypal-checkout.ts` |
| `billing_paypal_approved` / `billing_paypal_cancelled` / `billing_paypal_error` | `src/lib/billing/paypal-checkout.ts` |
| `billing_order_created` / `billing_order_captured` / `billing_order_capture_failed` | `src/routes/api/billing/paypal/*/+server.ts` |
| `billing_credits_ui_viewed` / `billing_insufficient_credits` | `src/lib/analytics/billing-events.ts` |
| `billing_mode_changed` | `src/lib/server/settings/llm-page.server.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior:

- **Dashboard**: [Analytics basics (wizard)](https://eu.posthog.com/project/208285/dashboard/769078)
- [Captures per day](https://eu.posthog.com/project/208285/insights/StcQudPS) — daily `capture_submitted` trend
- [Capture completion funnel](https://eu.posthog.com/project/208285/insights/Iwtc9MI7) — `capture_submitted` → `capture_completed`
- [Billing checkout funnel](https://eu.posthog.com/project/208285/insights/bxZCpkxm) — `billing_checkout_started` → `billing_checkout_completed`
- [Onboarding completions](https://eu.posthog.com/project/208285/insights/Z0H8CAXk) — daily unique users who finish onboarding
- [Capture errors](https://eu.posthog.com/project/208285/insights/ni0lt7n9) — daily `capture_failed` events

## Verify before merging

- [ ] Run a full production build (`npm run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `PUBLIC_POSTHOG_KEY`, `PUBLIC_POSTHOG_HOST`, and `POSTHOG_API_KEY` to `.env.example` (and any CI/staging secrets) so collaborators know what to set. The `.env.example` already has commented-out placeholders — uncomment them.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — the current implementation runs `identify` on every layout render when a user session is present, which correctly handles returning visitors.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-sveltekit/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>

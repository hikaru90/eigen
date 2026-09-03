/**
 * Browser-safe stubs for SvelteKit `$app/*` and `$env/static/public` virtual
 * modules, for component browser tests (same pattern as virtual-pwa-register).
 */
export const browser = true
export const dev = false

export function resolve(path) {
  return path
}

export function resolveRoute(path) {
  return path
}

export function enhance(_form, _submit) {
  return function cleanup() {}
}

export async function invalidateAll() {}

export const PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
export const PUBLIC_POSTHOG_KEY = 'test-key'

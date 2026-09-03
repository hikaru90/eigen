/**
 * Browser-safe stubs for SvelteKit `$app/*` and `$env/static/public` virtual
 * modules, for component browser tests (same pattern as virtual-pwa-register).
 */
export const browser = true
export const dev = false

export function resolve(path: string): string {
  return path
}

export function resolveRoute(path: string): string {
  return path
}

export function enhance(_form: HTMLFormElement, _submit?: () => void): () => void {
  return () => {}
}

export async function invalidateAll(): Promise<void> {}

export const PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
export const PUBLIC_POSTHOG_KEY = 'test-key'

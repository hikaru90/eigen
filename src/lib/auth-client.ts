import { createAuthClient } from 'better-auth/svelte'

/** Browser client for Better Auth (OAuth redirects, session stores). Same-origin; no baseURL required. */
export const authClient = createAuthClient()

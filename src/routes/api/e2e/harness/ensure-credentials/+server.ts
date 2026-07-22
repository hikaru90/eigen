import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { dev } from '$app/environment'
import { ensureHarnessCredentialAccount } from '$lib/server/e2e/harness-auth'

export const POST: RequestHandler = async ({ request }) => {
  if (!dev) {
    return json({ error: 'Harness credential API only available in dev mode' }, { status: 403 })
  }

  let body: { userId?: string }
  try {
    body = (await request.json()) as { userId?: string }
  } catch {
    error(400, 'Invalid JSON body')
  }

  const userId = body.userId?.trim()
  if (!userId) {
    error(400, 'userId is required')
  }

  const credentials = await ensureHarnessCredentialAccount(userId)
  return json(credentials)
}

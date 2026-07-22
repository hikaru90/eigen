import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { resolveConnectedAgentFromCallbackToken } from '$lib/server/agents/resolve-callback'
import { completeAgentAssignment } from '$lib/server/agents/complete-assignment'
import { withDbUser } from '$lib/server/db'
import { tenantUserAsyncLocal } from '$lib/server/billing/context'

export const POST: RequestHandler = async (event) => {
  const authHeader = event.request.headers.get('authorization') ?? ''
  const match = authHeader.match(/^Bearer\s+(\S+)$/i)
  if (!match) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resolved = await resolveConnectedAgentFromCallbackToken(match[1])
  if (!resolved) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await event.request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId.trim() : ''
  const status = body.status === 'completed' || body.status === 'failed' ? body.status : null
  const resultSummary = typeof body.resultSummary === 'string' ? body.resultSummary : undefined
  const captureText = typeof body.captureText === 'string' ? body.captureText : undefined

  if (!assignmentId) return json({ error: 'assignmentId is required' }, { status: 400 })
  if (!status) return json({ error: 'status must be completed or failed' }, { status: 400 })

  try {
    const result = await tenantUserAsyncLocal.run(resolved.userId, () =>
      withDbUser(resolved.userId, () =>
        completeAgentAssignment({
          userId: resolved.userId,
          agentId: resolved.agentId,
          assignmentId,
          status,
          resultSummary,
          captureText,
        }),
      ),
    )

    return json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = message.includes('not found') ? 404 : message.includes('terminal') ? 409 : 400
    return json({ error: message }, { status: code })
  }
}

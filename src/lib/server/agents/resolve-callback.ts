import { authSql } from '$lib/server/db/auth-db'
import { hashAgentSecret } from './secret-utils'

export async function resolveConnectedAgentFromCallbackToken(
  token: string,
): Promise<{ agentId: string; userId: string } | null> {
  const trimmed = token.trim()
  if (!trimmed.startsWith('eigen_cb_')) {
    return null
  }
  const hash = hashAgentSecret(trimmed)
  const rows = await authSql<Array<{ id: string; user_id: string }>>`
		SELECT id, user_id FROM resolve_agent_callback_token(${hash})
	`
  if (rows.length === 0) return null
  return { agentId: rows[0].id, userId: rows[0].user_id }
}

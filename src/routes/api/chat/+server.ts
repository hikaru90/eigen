import { error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  BRIEFING_BOOTSTRAP_MESSAGES,
  handleAgentChatPost,
  type AgentChatPostBody,
} from '$lib/server/chat/handle-agent-chat-post'

export const POST: RequestHandler = async (event) => {
  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON')
  }

  const b =
    typeof body === 'object' && body ? (body as AgentChatPostBody) : ({} as AgentChatPostBody)

  const bootstrap = b.bootstrap === true
  const briefingPeriod = typeof b.briefingPeriod === 'string' ? b.briefingPeriod.trim() : ''

  if (bootstrap && !briefingPeriod) {
    error(400, 'bootstrap requires briefingPeriod')
  }

  if (bootstrap && briefingPeriod && !BRIEFING_BOOTSTRAP_MESSAGES[briefingPeriod]) {
    error(400, 'Invalid briefingPeriod')
  }

  return handleAgentChatPost(event, b, {
    sessionMode: 'default',
    logTag: 'api/chat',
    resolveAgentUserMessage: ({ bootstrap, message, briefingPeriod: period }) => {
      if (bootstrap && period && BRIEFING_BOOTSTRAP_MESSAGES[period]) {
        return BRIEFING_BOOTSTRAP_MESSAGES[period]
      }
      return message
    },
  })
}

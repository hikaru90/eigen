import type { McpToolContext } from './tools'
import {
  boardStatusSchema,
  boardTitleSchema,
  firstIssue,
  parseIdeaId,
  parseVoteDirection,
} from '$lib/server/board/contract'
import { deleteBoardIdea, listBoardIdeas, setBoardVote } from '$lib/server/board/service'
import { checkBoardIdea, shareBoardIdea } from '$lib/server/board/share'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'

/**
 * MB-7: the shared Contribute board for agents. Budget: share → vote → list →
 * forget in ≤ 4 calls (docs/testing/agent-benchmark.md). Arguments are validated
 * strictly at the boundary — unknown keys and out-of-contract values fail loud.
 */

function strictArgs(args: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
    throw new Error('Arguments must be a JSON object')
  }
  const body = (args ?? {}) as Record<string, unknown>
  const unknown = Object.keys(body).find((k) => !allowed.includes(k))
  if (unknown)
    throw new Error(`Unknown argument: ${unknown}. Allowed: ${allowed.join(', ') || '(none)'}`)
  return body
}

export async function runListBoardTool(context: McpToolContext, args: unknown) {
  const body = strictArgs(args, ['status'])
  let status: string | undefined
  if (body.status !== undefined) {
    const parsed = boardStatusSchema.safeParse(body.status)
    if (!parsed.success) {
      throw new Error(
        `Invalid status: ${JSON.stringify(body.status)}. Must be requested, in-progress or shipped`,
      )
    }
    status = parsed.data
  }
  const ideas = await listBoardIdeas(context.userId)
  return sanitizeMcpToolResult({ ideas: status ? ideas.filter((i) => i.status === status) : ideas })
}

export async function runShareIdeaTool(context: McpToolContext, args: unknown) {
  const body = strictArgs(args, ['title', 'mine_is_different'])
  const title = boardTitleSchema.safeParse(body.title)
  if (!title.success) throw new Error(firstIssue(title.error))
  if (body.mine_is_different !== undefined && typeof body.mine_is_different !== 'boolean') {
    throw new Error('mine_is_different must be a boolean')
  }
  const check = await checkBoardIdea(context.userId, title.data)
  if (check.duplicateOf && body.mine_is_different !== true) {
    return sanitizeMcpToolResult({
      created: false,
      duplicateOf: check.duplicateOf,
      hint: 'The board judge found the same request. Call vote_idea on duplicateOf.id, or call share_idea again with mine_is_different: true.',
    })
  }
  const result = await shareBoardIdea({
    userId: context.userId,
    title: title.data,
    kind: check.kind,
    area: check.area,
  })
  return sanitizeMcpToolResult({ created: true, ...result })
}

export async function runVoteIdeaTool(context: McpToolContext, args: unknown) {
  const body = strictArgs(args, ['idea_id', 'direction'])
  const ideaId = parseIdeaId(body.idea_id)
  const direction = parseVoteDirection(body.direction)
  const result = await setBoardVote(context.userId, ideaId, direction)
  return sanitizeMcpToolResult({ ideaId, ...result })
}

export async function runForgetIdeaTool(context: McpToolContext, args: unknown) {
  const body = strictArgs(args, ['idea_id'])
  const ideaId = parseIdeaId(body.idea_id)
  await deleteBoardIdea(context.userId, ideaId)
  return sanitizeMcpToolResult({ forgotten: true, ideaId })
}

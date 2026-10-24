import type { McpToolContext } from './tools'
import {
  boardIdeaStatusSchema,
  boardStatusSchema,
  boardTitleSchema,
  firstIssue,
  parseIdeaId,
  parseVoteDirection,
} from '$lib/server/board/contract'
import {
  adminUpdateBoardIdea,
  deleteBoardIdea,
  getBoardIdea,
  listBoardIdeas,
  setBoardVote,
} from '$lib/server/board/service'
import { checkBoardIdea, shareBoardIdea } from '$lib/server/board/share'
import { BOARD_IDEA_STATUSES as BOARD_IDEA_STATUS_VALUES } from '$lib/feedback/board-types'
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

/** Makers (admin keys only): move status — `rejected` takes the idea off the board — and set the note. */
export async function runUpdateIdeaTool(context: McpToolContext, args: unknown) {
  const body = strictArgs(args, ['idea_id', 'status', 'note'])
  const ideaId = parseIdeaId(body.idea_id)
  if (body.status === undefined && body.note === undefined) {
    throw new Error('Nothing to change: pass status and/or note')
  }
  const patch: { status?: (typeof BOARD_IDEA_STATUS_VALUES)[number]; note?: string | null } = {}
  if (body.status !== undefined) {
    const parsed = boardIdeaStatusSchema.safeParse(body.status)
    if (!parsed.success) {
      throw new Error(
        `Invalid status: ${JSON.stringify(body.status)}. Must be ${BOARD_IDEA_STATUS_VALUES.join(', ')}`,
      )
    }
    patch.status = parsed.data
  }
  if (body.note !== undefined) {
    if (body.note !== null && (typeof body.note !== 'string' || !body.note.trim())) {
      throw new Error('note must be a non-empty string, or null to clear it')
    }
    patch.note = body.note === null ? null : body.note.trim()
  }
  await adminUpdateBoardIdea(context.userId, ideaId, patch)
  return sanitizeMcpToolResult({ ideaId, idea: await getBoardIdea(context.userId, ideaId) })
}

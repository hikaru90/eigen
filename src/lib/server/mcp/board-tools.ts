import type { McpToolContext } from './tools'
import { BOARD_IDEA_STATUSES as BOARD_IDEA_STATUS_VALUES } from '$lib/feedback/board-types'
import { isUserAdmin } from '$lib/server/auth/user-role'
import {
  boardIdeaStatusSchema,
  boardStatusSchema,
  boardTitleSchema,
  firstIssue,
  parseIdeaId,
  parseVoteDirection,
} from '$lib/server/board/contract'
import {
  adminDeleteBoardIdea,
  deleteBoardIdea,
  getBoardIdea,
  listBoardIdeas,
  setBoardVote,
} from '$lib/server/board/service'
import { adminEditBoardIdea, checkBoardIdea, shareBoardIdea } from '$lib/server/board/share'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'
import { strictToolArgs } from '$lib/server/validation/mcp-args'

/**
 * MB-7: the shared Contribute board for agents. Budget: share → vote → list →
 * forget in ≤ 4 calls (docs/testing/agent-benchmark.md). Arguments are validated
 * strictly at the boundary — unknown keys and out-of-contract values fail loud.
 */

export async function runListBoardTool(context: McpToolContext, args: unknown) {
  const body = strictToolArgs(args, ['status'])
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
  const body = strictToolArgs(args, ['title', 'mine_is_different'])
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
  const body = strictToolArgs(args, ['idea_id', 'direction'])
  const ideaId = parseIdeaId(body.idea_id)
  const direction = parseVoteDirection(body.direction)
  const result = await setBoardVote(context.userId, ideaId, direction)
  return sanitizeMcpToolResult({ ideaId, ...result })
}

export async function runForgetIdeaTool(context: McpToolContext, args: unknown) {
  const body = strictToolArgs(args, ['idea_id'])
  const ideaId = parseIdeaId(body.idea_id)
  if (await isUserAdmin(context.userId)) await adminDeleteBoardIdea(ideaId)
  else await deleteBoardIdea(context.userId, ideaId)
  return sanitizeMcpToolResult({ forgotten: true, ideaId })
}

/** Makers (admin keys only): edit the title, move status — `rejected` takes the idea off the board — and set the note. */
export async function runUpdateIdeaTool(context: McpToolContext, args: unknown) {
  const body = strictToolArgs(args, ['idea_id', 'title', 'status', 'note'])
  const ideaId = parseIdeaId(body.idea_id)
  if (body.title === undefined && body.status === undefined && body.note === undefined) {
    throw new Error('Nothing to change: pass title, status and/or note')
  }
  const patch: {
    title?: string
    status?: (typeof BOARD_IDEA_STATUS_VALUES)[number]
    note?: string | null
  } = {}
  if (body.title !== undefined) {
    const parsed = boardTitleSchema.safeParse(body.title)
    if (!parsed.success) throw new Error(firstIssue(parsed.error))
    patch.title = parsed.data
  }
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
  if (!(await isUserAdmin(context.userId))) throw new Error('Only the makers can update ideas')
  const { reward } = await adminEditBoardIdea(context.userId, ideaId, patch)
  return sanitizeMcpToolResult({ ideaId, idea: await getBoardIdea(context.userId, ideaId), reward })
}

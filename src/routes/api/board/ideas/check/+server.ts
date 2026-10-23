import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { boardCheckBodySchema, firstIssue } from '$lib/server/board/contract'
import { BoardError } from '$lib/server/board/errors'
import { boardHandler, readJsonBody } from '$lib/server/board/http'
import { checkBoardIdea } from '$lib/server/board/share'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'

/** MB-9: the LLM judge (billed, in the usage log). Creates nothing. */
export const POST: RequestHandler = (event) =>
  boardHandler(event.locals.user, async (userId) => {
    const parsed = boardCheckBodySchema.safeParse(await readJsonBody(event.request))
    if (!parsed.success) throw new BoardError(firstIssue(parsed.error), 400)
    return json(sanitizeMcpToolResult(await checkBoardIdea(userId, parsed.data.title)))
  })

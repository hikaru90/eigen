import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { boardCreateBodySchema, firstIssue } from '$lib/server/board/contract'
import { BoardError } from '$lib/server/board/errors'
import { boardHandler, readJsonBody } from '$lib/server/board/http'
import { shareBoardIdea } from '$lib/server/board/share'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'

/** MB-4: share an idea (judged kind/area from the check step). 201 even when the inbox email failed (D4). */
export const POST: RequestHandler = (event) =>
  boardHandler(event.locals.user, async (userId) => {
    const parsed = boardCreateBodySchema.safeParse(await readJsonBody(event.request))
    if (!parsed.success) throw new BoardError(firstIssue(parsed.error), 400)
    const result = await shareBoardIdea({ userId, ...parsed.data })
    return json(sanitizeMcpToolResult(result), { status: 201 })
  })

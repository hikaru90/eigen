import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { boardHandler } from '$lib/server/board/http'
import { listBoardIdeas } from '$lib/server/board/service'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'

/** MB-3: the shared board as the caller sees it. */
export const GET: RequestHandler = (event) =>
  boardHandler(event.locals.user, async (userId) =>
    json(sanitizeMcpToolResult({ ideas: await listBoardIdeas(userId) })),
  )

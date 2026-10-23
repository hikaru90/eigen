import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { parseIdeaId, parseVoteDirection } from '$lib/server/board/contract'
import { BoardError } from '$lib/server/board/errors'
import { boardHandler, readJsonBody } from '$lib/server/board/http'
import { setBoardVote } from '$lib/server/board/service'

/** MB-2: `{ direction: -1 | 0 | 1 }` (0 removes) → `{ score, myVote }`. */
export const PUT: RequestHandler = (event) =>
  boardHandler(event.locals.user, async (userId) => {
    const ideaId = parseIdeaId(event.params.id)
    const body = await readJsonBody(event.request)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BoardError('Body must be a JSON object', 400)
    }
    const extra = Object.keys(body).find((k) => k !== 'direction')
    if (extra) throw new BoardError(`Unknown field: ${extra}`, 400)
    const direction = parseVoteDirection((body as { direction?: unknown }).direction)
    return json(await setBoardVote(userId, ideaId, direction))
  })

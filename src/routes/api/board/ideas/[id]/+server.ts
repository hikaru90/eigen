import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { isUserAdmin } from '$lib/server/auth/user-role'
import { parseBoardPatch, parseIdeaId } from '$lib/server/board/contract'
import { BoardError } from '$lib/server/board/errors'
import { boardHandler, readJsonBody } from '$lib/server/board/http'
import {
  adminDeleteBoardIdea,
  correctBoardIdea,
  deleteBoardIdea,
  getBoardIdea,
} from '$lib/server/board/service'
import { adminEditBoardIdea } from '$lib/server/board/share'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'

/**
 * PATCH: the author corrects kind/area (Requested only), or the makers (admins,
 * D6) change title/status/planned/note/hidden. Non-admins sending maker fields → 403.
 */
export const PATCH: RequestHandler = (event) =>
  boardHandler(event.locals.user, async (userId) => {
    const ideaId = parseIdeaId(event.params.id)
    const patch = parseBoardPatch(await readJsonBody(event.request))
    if (patch.scope === 'admin') {
      if (!(await isUserAdmin(userId))) {
        throw new BoardError('Only the makers can change titles, status, notes or visibility', 403)
      }
      const { reward } = await adminEditBoardIdea(userId, ideaId, patch.patch)
      return json(sanitizeMcpToolResult({ idea: await getBoardIdea(userId, ideaId), reward }))
    }
    await correctBoardIdea(userId, ideaId, patch.patch)
    return json(sanitizeMcpToolResult({ idea: await getBoardIdea(userId, ideaId) }))
  })

/** MB-6: "Forget" — the author, Requested only; the makers delete any idea. */
export const DELETE: RequestHandler = (event) =>
  boardHandler(event.locals.user, async (userId) => {
    const ideaId = parseIdeaId(event.params.id)
    if (await isUserAdmin(userId)) await adminDeleteBoardIdea(ideaId)
    else await deleteBoardIdea(userId, ideaId)
    return json({ ok: true })
  })

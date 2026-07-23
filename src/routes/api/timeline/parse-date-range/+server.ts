import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  isParseDateRangeGatewayFailure,
  PARSE_DATE_RANGE_GATEWAY_USER_ERROR,
  parseDateRangePhrase,
} from '$lib/server/memory/parse-date-range'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { parseDateRangeRequestSchema } from '$lib/validation/api-bodies'

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON body')
  }

  const parsed = parseDateRangeRequestSchema.safeParse(body)
  if (!parsed.success) {
    error(400, parsed.error.issues[0]?.message ?? 'Invalid body')
  }

  const timeZone = parsed.data.timeZone ?? (await getUserPreferredTimezone(user.id))
  const nowIso = parsed.data.nowIso ?? new Date().toISOString()

  try {
    const result = await parseDateRangePhrase({
      userId: user.id,
      phrase: parsed.data.phrase,
      nowIso,
      timeZone,
    })
    return json(result)
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
      throw err
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[timeline.parse-date-range] failed', {
      userId: user.id,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    })
    if (isParseDateRangeGatewayFailure(message)) {
      return json({ error: PARSE_DATE_RANGE_GATEWAY_USER_ERROR }, { status: 502 })
    }
    return json({ error: message }, { status: 500 })
  }
}

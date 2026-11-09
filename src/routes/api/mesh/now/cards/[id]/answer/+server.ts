import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import {
  insufficientCreditsPayload,
  isInsufficientCreditsError,
} from '$lib/server/billing/insufficient-credits'
import { answerNowCard, NowAnswerError } from '$lib/server/mesh/now-answer'

const FIELDS = new Set(['answer', 'projectEntityId', 'text'])

type Body = { answer: string; projectEntityId?: string; text?: string }

/** Boundary check of the JSON shape only; what each answer needs is decided in `answerNowCard`. */
function parseBody(value: unknown): Body | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'Body must be a JSON object'
  }
  const record = value as Record<string, unknown>
  const unknown = Object.keys(record).filter((key) => !FIELDS.has(key))
  if (unknown.length > 0) return `Unknown field: ${unknown.join(', ')}`
  if (typeof record.answer !== 'string') return 'answer is required and must be a string'
  for (const key of ['projectEntityId', 'text'] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      return `${key} must be a string`
    }
  }
  return {
    answer: record.answer,
    ...(record.projectEntityId !== undefined ? { projectEntityId: record.projectEntityId as string } : {}),
    ...(record.text !== undefined ? { text: record.text as string } : {}),
  }
}

/** Answer a Now card (docs/planning/feature-mesh-now.md, section 5). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ error: 'Body must be valid JSON' }, { status: 400 })
  }
  const body = parseBody(raw)
  if (typeof body === 'string') return json({ error: body }, { status: 400 })

  try {
    return json(await answerNowCard({ userId: locals.user.id, cardId: params.id, ...body }))
  } catch (err) {
    if (err instanceof NowAnswerError) return json({ error: err.message }, { status: err.status })
    if (isInsufficientCreditsError(err)) {
      return json(insufficientCreditsPayload(err), { status: 402 })
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

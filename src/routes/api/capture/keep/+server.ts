import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { runWithTrace } from '$lib/server/activity/trace-context'
import {
  isInsufficientCreditsError,
  insufficientCreditsPayload,
} from '$lib/server/billing/insufficient-credits'
import { keepCaptureWithReading } from '$lib/server/capture/capture-confirmation'
import { parseOptionalIsoTimestamp } from '$lib/server/datetime/parse-iso'
import { captureGateHttpStatus, captureGateJsonBody } from '$lib/server/onboarding/capture-gate'

function collectErrorMessages(input: unknown): string[] {
  const parts: string[] = []
  let current = input
  let guard = 0
  while (current && guard < 8) {
    guard += 1
    if (current instanceof Error) {
      parts.push(current.message)
      current = current.cause
      continue
    }
    if (typeof current === 'object' && current) {
      const msg = 'message' in current ? (current as { message?: unknown }).message : undefined
      if (typeof msg === 'string' && msg.trim().length > 0) {
        parts.push(msg)
      }
      current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined
      continue
    }
    break
  }
  return parts.filter((v, i, arr) => v && arr.indexOf(v) === i)
}

/**
 * Keep a thought with the reading the user accepted up front (ei redesign decision #3).
 * Body: { raw, reading: CapturePreviewBundle, captured_at? }. This is the one call that
 * persists for the up-front flow: raw_text = raw as typed, normalized_text = the accepted
 * interpretedText, enrich scheduled. Same auth / error shape as /api/capture/submit.
 */
export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON')
  }

  const b = typeof body === 'object' && body ? (body as Record<string, unknown>) : {}
  const raw = typeof b.raw === 'string' ? b.raw : ''
  if (!raw.trim()) error(400, 'raw is required')
  if (!b.reading || typeof b.reading !== 'object') error(400, 'reading is required')

  let capturedAt: Date | undefined
  try {
    capturedAt = parseOptionalIsoTimestamp(b.captured_at, 'captured_at')
  } catch (err) {
    error(400, err instanceof Error ? err.message : 'Invalid captured_at')
  }

  try {
    const result = await runWithTrace(crypto.randomUUID(), () =>
      keepCaptureWithReading(user.id, raw, b.reading, {
        source: 'ui',
        ...(capturedAt ? { capturedAt } : {}),
      }),
    )
    return json(result)
  } catch (err) {
    const details = collectErrorMessages(err)
    const message = details[0] ?? 'Failed to keep thought'
    console.error('capture keep failed', { userId: user.id, message, details })
    return json(
      {
        ...captureGateJsonBody(err, message),
        ...(isInsufficientCreditsError(err) ? insufficientCreditsPayload(err) : {}),
        details,
      },
      { status: captureGateHttpStatus(err) },
    )
  }
}

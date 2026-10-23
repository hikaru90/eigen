import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import {
  isInsufficientCreditsError,
  insufficientCreditsPayload,
} from '$lib/server/billing/insufficient-credits'
import { interpretThoughtPreview } from '$lib/server/capture/interpret-thought'
import { captureGateHttpStatus, captureGateJsonBody } from '$lib/server/onboarding/capture-gate'

/**
 * The up-front reading (ei redesign decision #3): preview only.
 * Runs the interpret LLM pass and returns the CapturePreviewBundle — no queueCapture,
 * no thought row, nothing persisted. The accepted reading is kept later, once, by
 * POST /api/capture/keep when the user presses Capture.
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

  const raw =
    typeof body === 'object' && body && 'raw' in body ? String((body as { raw?: unknown }).raw) : ''
  if (!raw.trim()) error(400, 'raw is required')

  try {
    const preview = await interpretThoughtPreview({ userId: user.id, rawText: raw })
    return json({ preview })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read capture'
    console.error('capture read failed', { userId: user.id, message })
    return json(
      {
        ...captureGateJsonBody(err, message),
        ...(isInsufficientCreditsError(err) ? insufficientCreditsPayload(err) : {}),
      },
      { status: captureGateHttpStatus(err) },
    )
  }
}

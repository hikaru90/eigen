import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import {
  isInsufficientCreditsError,
  insufficientCreditsPayload,
} from '$lib/server/billing/insufficient-credits'
import {
  allowCaptureForceConfirmation,
  interpretAndQueueCapture,
} from '$lib/server/capture/capture-confirmation'
import { captureGateHttpStatus, captureGateJsonBody } from '$lib/server/onboarding/capture-gate'

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

  const wantsForce =
    typeof body === 'object' &&
    body !== null &&
    'forceConfirmation' in body &&
    Boolean((body as { forceConfirmation?: unknown }).forceConfirmation)

  if (wantsForce && !allowCaptureForceConfirmation()) {
    error(400, 'forceConfirmation is not allowed in production')
  }

  try {
    const result = await interpretAndQueueCapture(user.id, raw, {
      source: 'ui',
      ...(wantsForce ? { forceConfirmation: true } : {}),
    })
    return json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to interpret capture'
    console.error('capture interpret failed', { userId: user.id, message })
    return json(
      {
        ...captureGateJsonBody(err, message),
        ...(isInsufficientCreditsError(err) ? insufficientCreditsPayload(err) : {}),
      },
      { status: captureGateHttpStatus(err) },
    )
  }
}

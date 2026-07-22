import { describe, expect, it } from 'vitest'
import { chatErrorTerminalPayload } from './handle-agent-chat-post'
import { InsufficientCreditsError } from '$lib/server/billing/wallet'

describe('chatErrorTerminalPayload', () => {
  it('includes insufficient_credits code for InsufficientCreditsError', () => {
    const err = new InsufficientCreditsError({
      phase: 'precheck',
      availableCredits: 10,
      requiredCredits: 50,
    })
    const payload = chatErrorTerminalPayload(err, [err.message])
    expect(payload.type).toBe('error')
    expect(payload.code).toBe('insufficient_credits')
    expect(payload.availableCredits).toBe(10)
    expect(payload.requiredCredits).toBe(50)
  })

  it('returns generic error payload for other failures', () => {
    const payload = chatErrorTerminalPayload(new Error('boom'), ['boom'])
    expect(payload).toEqual({ type: 'error', error: 'boom', details: ['boom'] })
  })
})

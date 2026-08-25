import { describe, expect, it } from 'vitest'
import { InsufficientCreditsError } from '$lib/server/billing/wallet'
import {
  BRIEFING_BOOTSTRAP_MESSAGES,
  chatErrorTerminalPayload,
} from './handle-agent-chat-post'

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

describe('BRIEFING_BOOTSTRAP_MESSAGES', () => {
  it('covers morning, evening, and weekly periods', () => {
    expect(Object.keys(BRIEFING_BOOTSTRAP_MESSAGES).sort()).toEqual([
      'evening',
      'morning',
      'weekly',
    ])
  })

  it('never references removed list_temporal_events', () => {
    for (const [period, message] of Object.entries(BRIEFING_BOOTSTRAP_MESSAGES)) {
      expect(message, period).not.toMatch(/list_temporal_events/)
      expect(message, period).not.toMatch(/manage_temporal_event/)
    }
  })

  it('points the agent at available project and Q&A tools', () => {
    for (const [period, message] of Object.entries(BRIEFING_BOOTSTRAP_MESSAGES)) {
      expect(message, period).toMatch(/list_projects/)
      expect(message, period).toMatch(/get_project_timeline|answer_question|retrieve_thoughts/)
    }
  })
})

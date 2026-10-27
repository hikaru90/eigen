import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import {
  guardOutgoingEmbeddingInput,
  guardOutgoingMessages,
  guardOutgoingText,
} from './gateway-guard'

afterEach(() => vi.restoreAllMocks())

describe('gateway guard', () => {
  it('passes clean text through without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(guardOutgoingText('buy milk, commit 9f3a2c1', 'site')).toBe('buy milk, commit 9f3a2c1')
    expect(warn).not.toHaveBeenCalled()
  })

  it('redacts and warns once per call with the call site, kinds and names only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = guardOutgoingMessages(
      [
        { role: 'system' as const, content: 'ok' },
        {
          role: 'user' as const,
          content: `LLM_API_KEY=${FAKE_SECRETS.openai} and ${FAKE_SECRETS.githubClassic}`,
        },
      ],
      'decision_plane',
    )
    expect(leaks(JSON.stringify(out))).toBe(false)
    expect(out[0]).toEqual({ role: 'system', content: 'ok' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![1]).toEqual({
      callSite: 'decision_plane',
      count: 2,
      kinds: ['api_key', 'access_token'],
      names: ['LLM_API_KEY', 'github'],
    })
    expect(leaks(JSON.stringify(warn.mock.calls))).toBe(false)
  })

  it('handles single and batched embedding input', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(leaks(guardOutgoingEmbeddingInput(`k ${FAKE_SECRETS.openai}`, 'e'))).toBe(false)
    const batch = guardOutgoingEmbeddingInput(['a', `k ${FAKE_SECRETS.openai}`], 'e')
    expect(batch[0]).toBe('a')
    expect(leaks(batch.join(' '))).toBe(false)
  })
})

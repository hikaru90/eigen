import { describe, expect, it } from 'vitest'
import { isLlmHttpError, LlmHttpError } from './errors'

describe('LlmHttpError', () => {
  it('carries the status and keeps the legacy message format', () => {
    const err = new LlmHttpError(402, 'insufficient balance')
    expect(err.status).toBe(402)
    expect(err.name).toBe('LlmHttpError')
    expect(err.message).toBe('LLM HTTP 402: insufficient balance')
    expect(isLlmHttpError(err)).toBe(true)
    expect(isLlmHttpError(new Error('LLM HTTP 402: insufficient balance'))).toBe(false)
  })
})

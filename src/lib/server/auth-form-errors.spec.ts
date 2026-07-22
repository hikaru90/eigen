import { APIError } from 'better-auth/api'
import { describe, expect, it } from 'vitest'
import { getSafeErrorMessage } from './auth-form-errors'

describe('getSafeErrorMessage', () => {
  it('returns APIError message', () => {
    const error = new APIError('BAD_REQUEST', { message: 'api failed' })
    expect(getSafeErrorMessage(error, 'fallback')).toBe('api failed')
  })

  it('returns generic Error message', () => {
    expect(getSafeErrorMessage(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('returns message from plain object', () => {
    expect(getSafeErrorMessage({ message: 'x' }, 'fallback')).toBe('x')
  })

  it('returns fallback for unknown errors', () => {
    expect(getSafeErrorMessage(null, 'fallback')).toBe('fallback')
    expect(getSafeErrorMessage({ message: '  ' }, 'fallback')).toBe('fallback')
  })
})

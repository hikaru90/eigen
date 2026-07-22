import { describe, expect, it } from 'vitest'
import { isApiErrorBody, jsonError, type ApiErrorBody } from './api-error'

describe('api-error', () => {
  it('jsonError returns status and ApiErrorBody shape', async () => {
    const res = jsonError('Unauthorized', 401)
    expect(res.status).toBe(401)
    const body = (await res.json()) as ApiErrorBody
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(isApiErrorBody(body)).toBe(true)
  })

  it('jsonError merges optional details and code', async () => {
    const res = jsonError('capture orchestration failed', 500, {
      details: ['step a', 'step b'],
      code: 'orchestrate_failed',
    })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      error: 'capture orchestration failed',
      details: ['step a', 'step b'],
      code: 'orchestrate_failed',
    })
  })

  it('isApiErrorBody rejects non-objects and missing error string', () => {
    expect(isApiErrorBody(null)).toBe(false)
    expect(isApiErrorBody({ message: 'x' })).toBe(false)
    expect(isApiErrorBody({ error: 1 })).toBe(false)
    expect(isApiErrorBody({ error: 'ok' })).toBe(true)
  })
})

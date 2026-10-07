import { describe, expect, it } from 'vitest'
import { shouldCaptureServerError } from './server-error-capture'

describe('shouldCaptureServerError', () => {
  it('captures unexpected server faults (5xx)', () => {
    expect(shouldCaptureServerError(500)).toBe(true)
    expect(shouldCaptureServerError(502)).toBe(true)
    expect(shouldCaptureServerError(503)).toBe(true)
  })

  it('does not capture expected client-facing 4xx framework errors', () => {
    // SvelteKit routes framework-thrown SvelteKitError 4xx through handleError
    // as well: e.g. any POST (curl/scanners send Accept: *\/*) to a page without
    // form actions yields 405 "POST method not allowed. No form actions exist
    // for this page". These are requester errors, not app defects.
    expect(shouldCaptureServerError(400)).toBe(false)
    expect(shouldCaptureServerError(401)).toBe(false)
    expect(shouldCaptureServerError(403)).toBe(false)
    expect(shouldCaptureServerError(404)).toBe(false)
    expect(shouldCaptureServerError(405)).toBe(false)
    expect(shouldCaptureServerError(429)).toBe(false)
  })
})

/**
 * PostHog server error-capture policy: only unexpected server faults (HTTP 5xx)
 * are captured as exceptions.
 *
 * SvelteKit routes framework-thrown `SvelteKitError` 4xx through `handleError`
 * too — e.g. 404 for unknown URLs, or 405 "POST method not allowed. No form
 * actions exist for this page" when any POST (scanners/curl send
 * `Accept: *\/*`, which SvelteKit negotiates as JSON) hits a page without form
 * actions. Those are requester errors, not app defects; capturing them pollutes
 * error tracking with unactionable noise. Genuine app bugs surface as 5xx and
 * remain captured.
 */
export function shouldCaptureServerError(status: number): boolean {
  return status >= 500
}

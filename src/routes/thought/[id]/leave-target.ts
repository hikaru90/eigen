/**
 * Where leaving the thought page goes. `document.referrer` is unreliable, so list rows
 * pass a `from` query param; a missing or unsafe value falls back to the Yarn, the
 * thought's home on the mesh (docs/planning/ei-redesign.md, surface mapping).
 */

export const DEFAULT_LEAVE_TARGET = '/mesh/yarn'

/**
 * Accept only an in-app path: one leading slash, then anything but a second slash or
 * a backslash (which browsers treat as a scheme-relative URL). Query and hash ride along.
 */
export function leaveTarget(from: string | null | undefined): string {
  const value = (from ?? '').trim()
  if (!value.startsWith('/')) return DEFAULT_LEAVE_TARGET
  if (value.length > 1 && (value[1] === '/' || value[1] === '\\')) return DEFAULT_LEAVE_TARGET
  return value
}

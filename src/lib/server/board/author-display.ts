import { splitDisplayName } from '$lib/server/auth-user-name'

/**
 * D1: how an author appears to everyone on the board — first name plus last-name
 * initial ("Noor K."). Formatting only; never the email, the id or a full last name.
 * Null when the account carries no name at all (the row then shows no author).
 */
export function formatAuthorDisplay(input: {
  firstName?: string | null
  lastName?: string | null
  name?: string | null
}): string | null {
  let first = input.firstName?.trim() ?? ''
  let last = input.lastName?.trim() ?? ''
  if (!first) {
    const split = splitDisplayName(input.name ?? '')
    first = split.firstName ?? ''
    if (!last) last = split.lastName ?? ''
  }
  if (!first) return null
  const initial = Array.from(last)[0]
  return initial ? `${first} ${initial.toLocaleUpperCase()}.` : first
}

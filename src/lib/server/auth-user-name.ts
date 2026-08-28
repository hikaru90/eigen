export type UserNameFields = {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
}

/** Split a free-form display name into first / remainder (OAuth GitHub-style). */
export function splitDisplayName(displayName: string): { firstName?: string; lastName?: string } {
  const trimmed = displayName.trim()
  if (!trimmed) return {}

  const [firstName, ...rest] = trimmed.split(/\s+/)
  const lastName = rest.join(' ')
  return {
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
  }
}

export function composeDisplayName(firstName: string, lastName?: string | null): string {
  const given = firstName.trim()
  const family = lastName?.trim()
  return family ? `${given} ${family}` : given
}

/**
 * Ensures OAuth and email signups persist coherent `name`, `firstName`, and `lastName`.
 * Derives missing first name from display name; composes display name from parts when needed.
 */
export function normalizeUserNameFields(input: UserNameFields): Partial<UserNameFields> {
  const name = input.name?.trim() || undefined
  let firstName = input.firstName?.trim() || undefined
  let lastName = input.lastName?.trim() || undefined

  if (!firstName && name) {
    const split = splitDisplayName(name)
    firstName = split.firstName
    lastName = lastName ?? split.lastName
  }

  const composedName = firstName ? composeDisplayName(firstName, lastName) : name

  return {
    ...(composedName ? { name: composedName } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
  }
}

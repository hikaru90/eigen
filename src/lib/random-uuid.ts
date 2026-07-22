const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function uuidV4FromRandomValues(getRandomValues: (array: Uint8Array) => Uint8Array): string {
  const bytes = new Uint8Array(16)
  getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** RFC 4122 v4 UUID; works in non-secure HTTP contexts via getRandomValues fallback. */
export function randomUuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    return uuidV4FromRandomValues((array) => c.getRandomValues(array))
  }
  throw new Error('UUID generation is not available')
}

export function isUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value)
}

import crypto from 'node:crypto'

const KEY_PREFIX = 'eigen_'
const RANDOM_BYTES = 32
const PREFIX_DISPLAY_LENGTH = 12

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const randomHex = crypto.randomBytes(RANDOM_BYTES).toString('hex')
  const raw = `${KEY_PREFIX}${randomHex}`
  const prefix = raw.slice(0, PREFIX_DISPLAY_LENGTH) + '...'
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, prefix, hash }
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

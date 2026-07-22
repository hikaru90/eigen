import crypto from 'node:crypto'

const SIGNING_PREFIX = 'eigen_wh_'
const CALLBACK_PREFIX = 'eigen_cb_'
const RANDOM_BYTES = 32
const PREFIX_DISPLAY_LENGTH = 14

export function generateSigningSecret(): { raw: string; prefix: string; hash: string } {
  const randomHex = crypto.randomBytes(RANDOM_BYTES).toString('hex')
  const raw = `${SIGNING_PREFIX}${randomHex}`
  const prefix = raw.slice(0, PREFIX_DISPLAY_LENGTH) + '...'
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, prefix, hash }
}

export function generateCallbackToken(): { raw: string; prefix: string; hash: string } {
  const randomHex = crypto.randomBytes(RANDOM_BYTES).toString('hex')
  const raw = `${CALLBACK_PREFIX}${randomHex}`
  const prefix = raw.slice(0, PREFIX_DISPLAY_LENGTH) + '...'
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, prefix, hash }
}

export function hashAgentSecret(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex')
    const bufB = Buffer.from(b, 'hex')
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

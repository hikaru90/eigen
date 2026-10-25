/**
 * Synthetic credentials for secret-hygiene tests (docs/planning/secret-hygiene.md).
 *
 * Every value is fake and assembled at runtime from parts, so no credential-shaped literal is
 * ever committed (the OSS key scan, `scripts/assert-oss-no-secrets.mjs`, reads tracked sources).
 * Tests assert with `leaks(text)` (a boolean) rather than `toEqual` on strings that could hold a
 * value, so a failing run never prints one.
 */

import { redactSecrets } from '$lib/server/security/detect-secrets'

const join = (...parts: string[]): string => parts.join('')
const body = (seed: string, length: number): string =>
  seed.repeat(Math.ceil(length / seed.length)).slice(0, length)

export const FAKE_SECRETS = {
  openai: join('sk', '-', body('Zq8Lm2Xw9Rt4Vb7Nc3Hd5Jf1Kg6Ps0Ya', 48)),
  anthropic: join(
    'sk',
    '-',
    'ant',
    '-',
    'api03',
    '-',
    body('Hq7Lm2Xw9Rt4Vb7Nc3Hd5Jf1Kg6Ps0Ya', 60),
  ),
  openrouter: join('sk', '-', 'or', '-', 'v1', '-', body('Wq7Lm2Xw9Rt4Vb7Nc3Hd5Jf1Kg6Ps0Ya', 56)),
  githubClassic: join('gh', 'p', '_', body('Qw3Er5Ty7Ui9Op1As2Df4Gh6Jk8Lz0Xc', 36)),
  githubFineGrained: join('github', '_pat_', body('Nm4Bv6Cx8Za1Sd3Fg5Hj7Kl9Qw2Er', 70)),
  gitlab: join('glpat', '-', body('Tr5Ew2Qa8Sd4Fg6Hj1Kl', 22)),
  slack: join(
    'xox',
    'b',
    '-',
    '1234567890',
    '-',
    '0987654321',
    '-',
    body('AbCdEfGhIjKlMnOpQrStUvWx', 24),
  ),
  awsAccessKeyId: join('AK', 'IA', body('ZXCVBNM1QWERTYU2', 16)),
  googleApiKey: join('AI', 'za', body('Sy7Kq2Lm9Xw4Rt8Vb3Nc6Hd1Jf5Gp0Ya-_', 35)),
  stripeLive: join('sk', '_live_', body('Rt5Yu7Io9Pa1Sd3Fg5Hj7', 24)),
  jwt: join(
    'eyJ',
    'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    '.',
    'eyJ',
    'zdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUifQ',
    '.',
    body('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV', 40),
  ),
  pemPrivateKey: [
    join('-----BEGIN ', 'RSA PRIVATE', ' KEY-----'),
    body('MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun', 64),
    body('VbRdx2XqPoQwm1UEh7q5kZtD3sVJ3N0yH8wC9bPzQeJ4uA7sK2fL6oT1iY5rGn', 64),
    join('-----END ', 'RSA PRIVATE', ' KEY-----'),
  ].join('\n'),
  urlPassword: 'Tr0ub4dor3xk9Zq',
  plainPassword: 'correct-horse-9Battery',
  bearer: body('Zk8Pq2Lm9Xw4Rt7Vb3Nc6Hd1Jf5Gs0Ya', 40),
} as const

/**
 * Distinctive fragments that must never survive redaction: whole values, plus the interior of
 * the multi-part ones (PEM body lines, JWT signature) so a partial leak is caught too.
 */
export const LEAK_MARKERS: string[] = [
  ...Object.entries(FAKE_SECRETS)
    .filter(([name]) => name !== 'pemPrivateKey' && name !== 'jwt')
    .map(([, value]) => value),
  ...FAKE_SECRETS.pemPrivateKey.split('\n').slice(1, -1),
  FAKE_SECRETS.jwt.split('.')[2]!,
]

/** True when any synthetic secret value (or fragment of one) survives in `text`. */
export function leaks(text: string): boolean {
  return LEAK_MARKERS.some((value) => text.includes(value))
}

/** The `.env` paste from the PersonaMem evidence run, rebuilt from fakes. */
export function envPaste(): string {
  return [
    `DATABASE_URL=postgres://user:${FAKE_SECRETS.urlPassword}@localhost:5432/mydb`,
    `LLM_API_KEY=${FAKE_SECRETS.openai}`,
    'PORT=3000',
  ].join(' ')
}

/**
 * True when the gateway guard would find something to redact in any string of `value`
 * (recursively). A capture-path payload spy asserts this is false: the boundary already
 * redacted, so the guard never trips on the capture path.
 */
export function guardWouldTrip(value: unknown): boolean {
  if (typeof value === 'string') return redactSecrets(value).findings.length > 0
  if (Array.isArray(value)) return value.some((item) => guardWouldTrip(item))
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => guardWouldTrip(item))
  }
  return false
}

import { randomBytes } from 'node:crypto'
import webpush from 'web-push'
import { isEnvValuePresent, persistEnvValues } from './env-file.mjs'
import { writeRuntimeEnvFile } from './runtime-env.mjs'

function deriveVapidSubject() {
  const fromEnv = process.env.VAPID_SUBJECT?.trim()
  if (fromEnv) return fromEnv

  const adminEmail = process.env.ADMIN_EMAIL?.trim()
  if (adminEmail) return `mailto:${adminEmail}`

  const origin = process.env.ORIGIN?.trim()
  if (origin) {
    try {
      const host = new URL(origin).hostname
      if (host) return `mailto:ops@${host}`
    } catch {
      // fall through
    }
  }

  return 'mailto:ops@eigen.local'
}

/**
 * Generate missing VAPID / admin cron secrets into process.env.
 * @returns {{ generatedAdminKey: boolean; generatedVapid: boolean; persistedToEnvFile: boolean }}
 */
export function ensureDeploySecrets() {
  /** @type {Record<string, string>} */
  const toPersist = {}
  let generatedAdminKey = false
  let generatedVapid = false

  if (!isEnvValuePresent(process.env.ADMIN_CONSOLIDATION_KEY)) {
    const key = randomBytes(32).toString('hex')
    process.env.ADMIN_CONSOLIDATION_KEY = key
    toPersist.ADMIN_CONSOLIDATION_KEY = key
    generatedAdminKey = true
  }

  const hasPublic = isEnvValuePresent(process.env.VAPID_PUBLIC_KEY)
  const hasPrivate = isEnvValuePresent(process.env.VAPID_PRIVATE_KEY)
  const hasSubject = isEnvValuePresent(process.env.VAPID_SUBJECT)

  if (!(hasPublic && hasPrivate && hasSubject)) {
    if (hasPublic !== hasPrivate) {
      throw new Error(
        'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set or both be empty — fix .env and redeploy',
      )
    }

    const keys = webpush.generateVAPIDKeys()
    const subject = deriveVapidSubject()
    process.env.VAPID_PUBLIC_KEY = keys.publicKey
    process.env.VAPID_PRIVATE_KEY = keys.privateKey
    process.env.VAPID_SUBJECT = subject
    toPersist.VAPID_PUBLIC_KEY = keys.publicKey
    toPersist.VAPID_PRIVATE_KEY = keys.privateKey
    toPersist.VAPID_SUBJECT = subject
    generatedVapid = true
  }

  if (!generatedAdminKey && !generatedVapid) {
    writeRuntimeEnvFile()
    return { generatedAdminKey: false, generatedVapid: false, persistedToEnvFile: false }
  }

  const persistedToEnvFile = persistEnvValues(toPersist)

  console.log('[eigen] generated missing deploy secrets', {
    adminConsolidationKey: generatedAdminKey,
    vapid: generatedVapid,
    persistedToEnvFile,
  })

  if (!persistedToEnvFile) {
    console.warn(
      '[eigen] could not persist generated secrets to .env — copy ADMIN_CONSOLIDATION_KEY / VAPID_* into your platform env and redeploy',
    )
  }

  writeRuntimeEnvFile()

  return { generatedAdminKey, generatedVapid, persistedToEnvFile }
}

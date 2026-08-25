import webpush from 'web-push'
import { env as kitEnv } from '$lib/server/env/private-env'

export type VapidConfig = {
  publicKey: string
  privateKey: string
  subject: string
}

export type VapidEnvSource = {
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export function readVapidConfigFromEnv(env: VapidEnvSource = kitEnv): VapidConfig {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  const subject = env.VAPID_SUBJECT?.trim()
  if (!publicKey) throw new Error('VAPID_PUBLIC_KEY is required for web push')
  if (!privateKey) throw new Error('VAPID_PRIVATE_KEY is required for web push')
  if (!subject) throw new Error('VAPID_SUBJECT is required for web push (mailto: or https: URL)')
  return { publicKey, privateKey, subject }
}

export function configureWebPush(env: VapidEnvSource = kitEnv): VapidConfig {
  const config = readVapidConfigFromEnv(env)
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
  return config
}

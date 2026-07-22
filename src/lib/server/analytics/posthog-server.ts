import { env } from '$env/dynamic/private'
import { PostHog } from 'posthog-node'

const DEFAULT_EU_HOST = 'https://eu.i.posthog.com'

let client: PostHog | null = null

function posthogHost(): string {
  const host = (env as { PUBLIC_POSTHOG_HOST?: string }).PUBLIC_POSTHOG_HOST?.trim()
  return host || DEFAULT_EU_HOST
}

function getClient(): PostHog | null {
  const key = env.POSTHOG_API_KEY?.trim()
  if (!key) return null
  if (!client) {
    client = new PostHog(key, { host: posthogHost() })
  }
  return client
}

export type CaptureServerEventInput = {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
}

export function captureServerEvent(input: CaptureServerEventInput): void {
  const c = getClient()
  if (!c) return
  c.capture({
    distinctId: input.distinctId,
    event: input.event,
    properties: input.properties,
  })
}

export function captureServerException(
  error: unknown,
  distinctId?: string,
  properties?: Record<string, unknown>,
): void {
  const c = getClient()
  if (!c) return
  c.captureException(error, distinctId, properties)
}

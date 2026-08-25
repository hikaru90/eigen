import { env } from '$lib/server/env/private-env'

const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export function validateAgentWebhookUrl(
  rawUrl: string,
): { ok: true; url: URL } | { ok: false; error: string } {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return { ok: false, error: 'Webhook URL is required' }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Webhook URL must be a valid URL' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Webhook URL must use http or https' }
  }

  const isDev = env.NODE_ENV !== 'production'
  const hostname = parsed.hostname.toLowerCase()

  if (parsed.protocol === 'http:' && !isDev) {
    return { ok: false, error: 'Webhook URL must use https in production' }
  }

  if (!isDev) {
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
      return { ok: false, error: 'Webhook URL hostname is not allowed' }
    }
    if (isPrivateIpv4(hostname)) {
      return { ok: false, error: 'Webhook URL must not target a private network address' }
    }
  }

  return { ok: true, url: parsed }
}

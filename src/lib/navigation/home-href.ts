import { resolve } from '$app/paths'

/** External marketing site when configured; otherwise the in-app home route. */
export function homeHref(websiteOrigin: string): string {
  const origin = websiteOrigin.trim()
  if (origin) return origin
  return resolve('/')
}

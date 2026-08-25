/**
 * Canonical marketing-site paths for legally required documents.
 * Content lives on the website (eigenmesh.xyz), not in the app.
 */
export const WEBSITE_LEGAL_PATHS = {
  terms: '/terms',
  privacy: '/privacy',
  imprint: '/imprint',
} as const

export type WebsiteLegalDoc = keyof typeof WEBSITE_LEGAL_PATHS

/** Production marketing origin used when PUBLIC_WEBSITE_ORIGIN is unset. */
export const DEFAULT_WEBSITE_ORIGIN = 'https://eigenmesh.xyz'

/**
 * Absolute URL to a legal document on the Eigen Mesh website.
 * Prefer `PUBLIC_WEBSITE_ORIGIN` when set (preview / staging sites).
 */
export function websiteLegalUrl(
  doc: WebsiteLegalDoc,
  websiteOrigin: string | undefined = undefined,
): string {
  const raw = (websiteOrigin ?? '').trim() || DEFAULT_WEBSITE_ORIGIN
  const origin = raw.replace(/\/$/, '')
  return `${origin}${WEBSITE_LEGAL_PATHS[doc]}`
}

/**
 * Tenant-id fragment for a chat model: the part after the last `/`, lowercased, keeping only
 * `[a-z0-9.-]`. Id formatting only, not a semantic classification.
 */
export function modelSlug(model: string): string {
  const name = model.slice(model.lastIndexOf('/') + 1)
  const slug = name.toLowerCase().replace(/[^a-z0-9.-]/g, '')
  if (!slug) throw new Error(`[public-bench] model "${model}" yields an empty slug`)
  return slug
}

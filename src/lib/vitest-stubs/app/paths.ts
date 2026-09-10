/**
 * Browser-mode stub for `$app/paths`.
 *
 * Specs don't navigate; identity resolution keeps runtime-built hrefs
 * pointing at the same path they were built from.
 */
export const base = ''
export const assets = ''

export function resolve(path: string): string {
  return path
}

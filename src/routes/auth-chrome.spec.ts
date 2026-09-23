import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The root layout hides the app chrome (header wordmark + bottom nav) on auth pages.
 * `/forgot-password` and `/reset-password` render their own standalone wordmark, so they
 * must be in the same auth-path set — otherwise the page shows a doubled logo with the
 * fixed header wordmark overlaid (reported by a PWA user, Sep 2026).
 *
 * The set lives inline in +layout.svelte (component code, not unit-importable), so this
 * test asserts on the source text — it fails if the paths are ever removed again.
 */
const AUTH_PATHS = ['/login', '/signup', '/register', '/forgot-password', '/reset-password']

function readLayoutSource(): string {
  return readFileSync(join(process.cwd(), 'src/routes/+layout.svelte'), 'utf8')
}

describe('auth pages without app chrome', () => {
  it('lists every standalone auth page in the layout authPaths set', () => {
    const source = readLayoutSource()
    const setMatch = source.match(/const authPaths = new Set\(\[([^\]]*)\]\)/)
    expect(setMatch, 'authPaths set not found in +layout.svelte').not.toBeNull()
    const declared = (setMatch?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
    for (const path of AUTH_PATHS) {
      expect(declared, `${path} must be hidden from app chrome`).toContain(path)
    }
  })
})

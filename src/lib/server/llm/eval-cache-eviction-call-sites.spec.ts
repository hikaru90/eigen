import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A chat reply the caller rejects (wrong shape, missing field, bad contract) must be dropped from
 * the eval response cache before the caller throws or re-asks (`evictOnReject`,
 * `evictEvalLlmCacheEntry`); otherwise the cache replays the same rejected reply on every retry
 * and resume (the PersonaMem p196 and p555 failures).
 *
 * Structural guard, same shape as json-mode-call-sites.spec.ts: every file that calls
 * `llmChatCompletion(` must use an eviction at least once per call, except the calls whose answer
 * is free text (nothing to reject).
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCAN_DIRS = ['src', 'evals']

/** Calls whose answer is free text, not parsed. */
const FREE_TEXT_CALL_SITES = new Set(['src/lib/server/qa/compose-answer.ts'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

const count = (text: string, needle: RegExp) => (text.match(needle) ?? []).length

describe('llmChatCompletion call sites evict a rejected reply from the eval cache', () => {
  const files = SCAN_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, 'utf8') }))
    .filter(({ path }) => path !== 'src/lib/server/llm/llm-client.ts')
    .map(({ path, text }) => ({
      path,
      calls: count(text, /llmChatCompletion\(/g),
      evictions: count(text, /\bevict(?:OnReject|EvalLlmCacheEntry)\(/g),
    }))
    .filter(({ calls }) => calls > 0)

  it('finds the call sites', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('has at least one eviction per call in every parsing file', () => {
    const missing = files
      .filter(({ path }) => !FREE_TEXT_CALL_SITES.has(path))
      .filter(({ calls, evictions }) => evictions < calls)
      .map(({ path, calls, evictions }) => `${path}: ${calls} call(s), ${evictions} eviction(s)`)
    expect(missing).toEqual([])
  })

  it('keeps the free-text allowlist honest (every entry still calls the gateway)', () => {
    for (const path of FREE_TEXT_CALL_SITES) {
      expect(files.some((f) => f.path === path)).toBe(true)
    }
  })
})

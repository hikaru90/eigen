import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Every chat call whose answer is parsed as JSON must request `responseFormat: 'json_object'`.
 * Without it a model may answer in prose ("Please paste ..."), which fails the step with a
 * `SyntaxError` (the PersonaMem p196 failure) instead of being constrained at the gateway.
 *
 * Structural guard over the call sites (not a semantic judgement about any user text): each
 * `llmChatCompletion({ ... })` argument object must contain the option, except the calls listed
 * below whose answer is free text.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCAN_DIRS = ['src', 'evals']

/** Calls whose answer is free text, not JSON. */
const FREE_TEXT_CALL_SITES = new Set(['src/lib/server/qa/compose-answer.ts'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

/** The `{ ... }` argument of each `llmChatCompletion(` call in `text`, with its line number. */
function callArguments(text: string): Array<{ line: number; argument: string }> {
  const found: Array<{ line: number; argument: string }> = []
  const needle = 'llmChatCompletion('
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const open = text.indexOf('{', at)
    if (open === -1 || text.slice(at + needle.length, open).trim() !== '') continue
    let depth = 0
    let end = open
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++
      else if (text[end] === '}' && --depth === 0) break
    }
    found.push({
      line: text.slice(0, at).split('\n').length,
      argument: text.slice(open, end + 1),
    })
  }
  return found
}

describe('llmChatCompletion call sites', () => {
  const sites = SCAN_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir))).flatMap((file) => {
    const path = relative(ROOT, file)
    if (path === 'src/lib/server/llm/llm-client.ts') return []
    return callArguments(readFileSync(file, 'utf8')).map((call) => ({ path, ...call }))
  })

  it('finds the call sites', () => {
    expect(sites.length).toBeGreaterThan(30)
  })

  it("requests responseFormat: 'json_object' at every JSON call site", () => {
    const missing = sites
      .filter((s) => !FREE_TEXT_CALL_SITES.has(s.path))
      .filter((s) => !/responseFormat:\s*'json_object'/.test(s.argument))
      .map((s) => `${s.path}:${s.line}`)
    expect(missing).toEqual([])
  })

  it('keeps the free-text allowlist honest (every entry still calls the gateway)', () => {
    for (const path of FREE_TEXT_CALL_SITES) {
      expect(sites.some((s) => s.path === path)).toBe(true)
    }
  })
})

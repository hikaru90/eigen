import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * An identifier's value (docs/planning/user-facts-layer.md, Q3) is written once, encrypted, by the
 * fact store and decrypted in exactly one place, `substituteSecureReferences`, which runs after
 * generation on a user-facing response. Structural guard over the source: no other module reads the
 * encrypted column or decrypts the `user_secure_value` table, so a value cannot reach an LLM
 * payload, an index, a log or a tool result by a new code path without this spec failing.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCAN_DIRS = ['src', 'evals', 'scripts']

const READS_THE_VALUE = new Set(['src/lib/server/facts/secure-values.ts'])
const WRITES_THE_VALUE = new Set(['src/lib/server/facts/user-fact-store.ts'])

/**
 * Where a value may leave the server: the user-facing response of an Ask turn and the display read
 * of a stored session. Both run after generation; neither feeds a prompt, a log or an activity row.
 */
const SUBSTITUTES_FOR_THE_USER = new Set([
  'src/lib/server/chat/handle-agent-chat-post.ts',
  'src/lib/server/chat/chat-sessions.ts',
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|svelte|mjs)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [path] : []
  })
}

const files = SCAN_DIRS.flatMap((dir) => {
  try {
    return sourceFiles(join(ROOT, dir))
  } catch {
    return []
  }
}).map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, 'utf8') }))

describe('secure value boundary', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('only the substitution module selects the encrypted value', () => {
    const offenders = files
      .filter(({ path }) => !READS_THE_VALUE.has(path))
      .filter(({ text }) => /userSecureValue\.valueEncrypted/.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('only the substitution module decrypts the user_secure_value table', () => {
    const offenders = files
      .filter(({ path }) => !READS_THE_VALUE.has(path))
      .filter(({ text }) => /decryptTenantValue\(\{[^}]*?table:\s*'user_secure_value'/s.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('only the fact store encrypts a value into the table', () => {
    const offenders = files
      .filter(({ path }) => !WRITES_THE_VALUE.has(path))
      .filter(({ text }) => /encryptTenantValue\(\{[^}]*?table:\s*'user_secure_value'/s.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('only the response boundaries (Ask turn response, stored-session display) substitute values', () => {
    const offenders = files
      .filter(({ path }) => path !== 'src/lib/server/facts/secure-values.ts')
      .filter(({ path }) => !SUBSTITUTES_FOR_THE_USER.has(path))
      .filter(({ text }) => /\b(?:resolveSecureReferences|substituteSecureReferences)\b/.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('the model-facing layers (compose, agent loop, harness) never import the substitution module', () => {
    const modelFacing = files.filter(
      ({ path }) =>
        path.startsWith('src/lib/server/qa/') ||
        path.startsWith('src/lib/server/llm/') ||
        path.startsWith('src/lib/server/mcp/') ||
        path.startsWith('evals/'),
    )
    expect(modelFacing.length).toBeGreaterThan(20)
    const offenders = modelFacing
      .filter(({ text }) => /facts\/secure-values/.test(text))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  it('keeps the allowlists honest (every entry still does what it is allowed to)', () => {
    for (const path of READS_THE_VALUE) {
      expect(files.find((f) => f.path === path)?.text).toMatch(
        /decryptTenantValue\(\{[^}]*?table:\s*'user_secure_value'/s,
      )
    }
    for (const path of WRITES_THE_VALUE) {
      expect(files.find((f) => f.path === path)?.text).toMatch(
        /encryptTenantValue\(\{[^}]*?table:\s*'user_secure_value'/s,
      )
    }
    for (const path of SUBSTITUTES_FOR_THE_USER) {
      expect(files.find((f) => f.path === path)?.text).toMatch(/\bresolveSecureReferences\b/)
    }
  })

  it('no module selects a fact embedding', () => {
    const offenders = files
      .filter(({ text }) => /userFact\.embedding/.test(text))
      .filter(({ text }) => !/<=>/.test(text))
      .map(({ path }) => path)
    // userFact.embedding appears only inside the distance expression of the search query
    expect(offenders).toEqual([])
  })
})

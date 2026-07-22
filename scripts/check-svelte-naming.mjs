/**
 * Fail when a .svelte file under src/ uses PascalCase outside shadcn ui/.
 * Canonical convention: kebab-case component filenames.
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const PASCAL_SVELTE = /^[A-Z][A-Za-z0-9]*\.svelte$/
const UI_PREFIX = join('src', 'lib', 'components', 'ui')

/**
 * @param {string} rootAbs Absolute path to the repo (or subtree) root that contains `src/`.
 * @returns {string[]} Relative paths of violating files.
 */
export function findPascalCaseSvelteFiles(rootAbs) {
  const srcRoot = join(rootAbs, 'src')
  /** @type {string[]} */
  const violations = []

  /**
   * @param {string} dir
   */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const abs = join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(abs)
        continue
      }
      if (!PASCAL_SVELTE.test(name)) continue
      const rel = relative(rootAbs, abs)
      if (rel.startsWith(UI_PREFIX + '/') || rel.startsWith(UI_PREFIX + '\\')) continue
      violations.push(rel.replace(/\\/g, '/'))
    }
  }

  walk(srcRoot)
  return violations.sort()
}

/**
 * @param {string} rootAbs
 * @returns {{ ok: true } | { ok: false; violations: string[] }}
 */
export function checkSvelteNaming(rootAbs) {
  const violations = findPascalCaseSvelteFiles(rootAbs)
  if (violations.length === 0) return { ok: true }
  return { ok: false, violations }
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('check-svelte-naming.mjs') ||
    process.argv[1].includes('check-svelte-naming'))

if (isMain) {
  const root = process.cwd()
  const result = checkSvelteNaming(root)
  if (!result.ok) {
    console.error('PascalCase .svelte filenames are not allowed (use kebab-case):')
    for (const v of result.violations) console.error(`  - ${v}`)
    process.exit(1)
  }
  console.log('Svelte naming check passed (kebab-case).')
}

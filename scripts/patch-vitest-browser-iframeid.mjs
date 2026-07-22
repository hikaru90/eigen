/**
 * Vitest browser passes absolute file paths as the `iframeId` query param without
 * encoding. Paths containing `+` (e.g. `.../+Code/eigen`) are decoded as spaces
 * in URLSearchParams, so the tester iframe never prepares and tests hang at 0/0.
 *
 * Idempotent patch of the published orchestrator bundle until Vitest encodes iframeId.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const browserRoot = path.dirname(require.resolve('@vitest/browser/package.json'))
const dir = path.join(browserRoot, 'dist/client/__vitest_browser__')

if (!existsSync(dir)) {
  throw new Error(`@vitest/browser orchestrator dir missing: ${dir}`)
}

const match = readdirSync(dir).find((name) => name.startsWith('orchestrator-') && name.endsWith('.js'))
if (!match) {
  throw new Error(`No orchestrator-*.js in ${dir}`)
}

const orchestratorPath = path.join(dir, match)
const source = readFileSync(orchestratorPath, 'utf8')
const unencoded =
  'const src = `/?sessionId=${getBrowserState().sessionId}&iframeId=${iframeId}`;'
const encoded =
  'const src = `/?sessionId=${getBrowserState().sessionId}&iframeId=${encodeURIComponent(iframeId)}`;'

if (source.includes(encoded)) {
  console.log(`[patch-vitest-browser-iframeid] already applied: ${orchestratorPath}`)
  process.exit(0)
}

if (!source.includes(unencoded)) {
  console.warn(
    `[patch-vitest-browser-iframeid] pattern not found in ${orchestratorPath}; Vitest may have fixed this — skipping`,
  )
  process.exit(0)
}

writeFileSync(orchestratorPath, source.replace(unencoded, encoded))
console.log(`[patch-vitest-browser-iframeid] patched: ${orchestratorPath}`)

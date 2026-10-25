/**
 * Writes the committed dev-set file from the prepared val and benchmark data:
 *   npx vite-node --config evals/vite.config.ts evals/personamem/make-dev-set.ts -- \
 *     --data-dir evals/.data/personamem-v2 --seed <seed> --out evals/personamem/dev-set.val.json
 * Reads only local files; touches no database and no LLM. Same data + same seed = same file.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEV_SET_DEFAULTS, devSetForDataDir } from './dev-set'

function flag(argv: readonly string[], name: string): string {
  const i = argv.indexOf(name)
  const value = i < 0 ? undefined : argv[i + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} is required`)
  return value
}

const argv = process.argv.slice(2).filter((arg) => arg !== '--')
const file = devSetForDataDir(resolve(flag(argv, '--data-dir')), {
  ...DEV_SET_DEFAULTS,
  seed: flag(argv, '--seed'),
})
const out = resolve(flag(argv, '--out'))
writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`)
console.log(`wrote ${file.questionIds.length} questions to ${out}`)
console.log(`per pref_type: ${JSON.stringify(file.prefTypeCounts)}`)
console.log(`val personas also in benchmark (excluded): ${JSON.stringify(file.excludedPersonaIds)}`)

/**
 * Lists the val personas a full-history run replays, and how to fetch just their histories:
 *   npx vite-node --config evals/vite.config.ts evals/personamem/list-val-personas.ts -- \
 *     --data-dir evals/.data/personamem-v2 --personas 20 --seed val-full-1
 * Same selection as `--split val --personas N --seed S` of the run. Reads only local files;
 * touches no database and no LLM.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { groupByPersona, loadPreparedRows } from './load-dataset'
import { selectValPersonas, summarizeValPersonas, valHistoryLinks } from './val-personas'

function flag(argv: readonly string[], name: string): string {
  const i = argv.indexOf(name)
  const value = i < 0 ? undefined : argv[i + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} is required`)
  return value
}

const argv = process.argv.slice(2).filter((arg) => arg !== '--')
const dataDir = resolve(flag(argv, '--data-dir'))
const count = Number(flag(argv, '--personas'))
if (!Number.isInteger(count) || count < 1) throw new Error('--personas must be a positive integer')
const seed = flag(argv, '--seed')

const val = groupByPersona(loadPreparedRows(dataDir, 'val'))
const benchmark = new Set(loadPreparedRows(dataDir, 'benchmark').map((r) => r.personaId))
const picked = selectValPersonas(val, benchmark, count, seed)
const summary = summarizeValPersonas(picked)
const missing = picked.filter((p) => !existsSync(p.historyPath))

console.log(`val full-history personas (seed ${JSON.stringify(seed)}): ${picked.length}`)
console.log(`persona ids: ${summary.personaIds.join(',')}`)
console.log(`questions: ${summary.questions}`)
console.log(`per pref_type: ${JSON.stringify(summary.prefTypeCounts)}`)
console.log(`history files on disk: ${picked.length - missing.length} of ${picked.length}`)
for (const { personaId, link } of valHistoryLinks(dataDir, missing)) {
  console.log(`  missing: persona ${personaId}  ${link}`)
}
console.log(
  `urls: python3 -I evals/personamem/prepare.py --data-dir ${dataDir} --split val --print-history-urls --persona-ids ${summary.personaIds.join(',')}`,
)

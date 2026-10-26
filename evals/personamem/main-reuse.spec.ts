import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parsePersonaMemCli } from './cli'
import { captureDigest, type IngestRecord } from './ingest-record'
import { main } from './main'
import { buildPlan } from './plan'
import { openRun, type RunIdentity } from './run-meta'
import { writeFixtureDataDir } from './test-fixtures'

let dataDir = ''
let reportsRoot = ''
const CHAT_MODEL = 'deepseek/deepseek-v4.1-flash-1017'

beforeAll(() => {
  dataDir = writeFixtureDataDir({ split: 'val' })
  const res = spawnSync(
    'python3',
    ['-I', resolve(import.meta.dirname, 'prepare.py'), '--data-dir', dataDir, '--split', 'val'],
    { encoding: 'utf8' },
  )
  if (res.status !== 0) throw new Error(res.stderr)
  reportsRoot = mkdtempSync(join(tmpdir(), 'personamem-main-reuse-'))
})
afterAll(() => rmSync(reportsRoot, { recursive: true, force: true }))

const argv = (extra: string[]) => [
  '--data-dir',
  dataDir,
  '--split',
  'val',
  '--chat-model',
  CHAT_MODEL,
  '--tenant-concurrency',
  '1',
  '--enrich-concurrency',
  '1',
  '--answer',
  'ask',
  '--relevance-floor',
  '0.15',
  '--persona-ids',
  '7,9',
  '--dry-run',
  ...extra,
]

const identity: RunIdentity = {
  split: 'val',
  chatModel: CHAT_MODEL,
  answer: 'ask',
  evidenceOnly: false,
  personaIds: [7, 9],
  questionIds: [],
  limitQueries: null,
  enrichConcurrency: 1,
  relevanceFloor: 'product',
  reuseIngest: null,
  maxHistoryTurns: null,
}

function writeSource(runId: string, only?: number): void {
  const plan = buildPlan(parsePersonaMemCli(argv([])))
  const { paths } = openRun({ runId, identity, resume: false, reportsRoot })
  const records: IngestRecord[] = plan.personas
    .filter((p) => only === undefined || p.personaId === only)
    .map((p) => ({
      personaId: p.personaId,
      tenantUserId: p.tenantUserId,
      captures: p.captures.length,
      captureDigest: captureDigest(p.captures),
      thoughtIds: p.captures.map((_, i) => `th-${p.personaId}-${i}`),
      thoughtCount: p.captures.length,
      usd: 0,
      ms: 0,
    }))
  writeFileSync(paths.ingest, records.map((r) => `${JSON.stringify(r)}\n`).join(''))
}

describe('main --dry-run --reuse-ingest', () => {
  it('verifies the source run offline and says so', async () => {
    writeSource('ok-source')
    const lines: string[] = []
    await main(argv(['--reuse-ingest', 'ok-source']), (l) => lines.push(l), reportsRoot)
    const text = lines.join('\n')
    expect(text).toContain('run ok-source (--reuse-ingest; nothing is ingested)')
    expect(text).toMatch(
      /ingest reuse: run ok-source verified offline: 2 tenant\(s\), 10 capture\(s\)/,
    )
  })

  it('fails when the source run did not ingest a planned tenant', async () => {
    writeSource('partial-source', 7)
    await expect(
      main(argv(['--reuse-ingest', 'partial-source']), () => {}, reportsRoot),
    ).rejects.toThrow(/partial-source did not ingest tenant .*-p9/)
  })

  it('fails when the source run does not exist', async () => {
    await expect(
      main(argv(['--reuse-ingest', 'no-such-run']), () => {}, reportsRoot),
    ).rejects.toThrow(/no-such-run.*not found/)
  })

  it('a dry run without --reuse-ingest touches no run directory', async () => {
    const lines: string[] = []
    await main(argv([]), (l) => lines.push(l), reportsRoot)
    expect(lines.join('\n')).not.toMatch(/ingest reuse/)
  })
})

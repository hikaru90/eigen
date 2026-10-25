import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFixtureDataDir } from './test-fixtures'

const SRC_LIB = resolve(import.meta.dirname, '../../src/lib')

vi.mock('$lib/server/db', () => {
  throw new Error('dry run must not load the database')
})
vi.mock('$lib/server/llm/llm-client', () => {
  throw new Error('dry run must not load the LLM client')
})
vi.mock('../harness/eval-context', () => {
  throw new Error('dry run must not load the eval context')
})
vi.mock('./run-live', () => {
  throw new Error('dry run must not load the live path')
})

/** Static (non-type) import specifiers of a source file. */
function staticSpecifiers(source: string): string[] {
  const specs: string[] = []
  for (const match of source.matchAll(/^(import|export)\s(?!type\b)[^;]*?from\s+'([^']+)'/gm)) {
    specs.push(match[2]!)
  }
  for (const match of source.matchAll(/^import\s+'([^']+)'/gm)) specs.push(match[1]!)
  return specs
}

function resolveSpecifier(from: string, spec: string): string | null {
  const base = spec.startsWith('$lib/')
    ? resolve(SRC_LIB, spec.slice('$lib/'.length))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null
  return base ? `${base}.ts` : null
}

function closure(entry: string): { files: Set<string>; external: Set<string> } {
  const files = new Set<string>()
  const external = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)
    for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
      const resolved = resolveSpecifier(file, spec)
      if (resolved) queue.push(resolved)
      else external.add(spec)
    }
  }
  return { files, external }
}

describe('dry-run isolation', () => {
  it('the static import closure of main.ts reaches no DB, LLM or harness module', () => {
    const { files, external } = closure(resolve(import.meta.dirname, 'main.ts'))
    expect([...external].filter((s) => !s.startsWith('node:') && s !== 'zod')).toEqual([])
    const serverFiles = [...files].filter((f) => f.startsWith(resolve(SRC_LIB, 'server')))
    expect(serverFiles).toEqual([resolve(SRC_LIB, 'server/llm/eval-chat-model.ts')])
    expect([...files].filter((f) => f.includes('/harness/'))).toEqual([])
  })

  it('ask-answer is never in the static closure of main.ts', () => {
    const { files } = closure(resolve(import.meta.dirname, 'main.ts'))
    expect([...files].filter((f) => f.endsWith('/ask-answer.ts'))).toEqual([])
  })

  it('main.ts reaches the live path only through a dynamic import', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'main.ts'), 'utf8')
    expect(source).toMatch(/await import\('\.\/run-live'\)/)
    expect(staticSpecifiers(source)).not.toContain('./run-live')
  })

  describe('main --dry-run', () => {
    let dataDir = ''
    beforeAll(() => {
      dataDir = writeFixtureDataDir()
      const res = spawnSync(
        'python3',
        [
          '-I',
          resolve(import.meta.dirname, 'prepare.py'),
          '--data-dir',
          dataDir,
          '--split',
          'benchmark',
        ],
        { encoding: 'utf8' },
      )
      if (res.status !== 0) throw new Error(res.stderr)
    })

    it('prints the plan without loading any mocked DB/LLM module', async () => {
      const lines: string[] = []
      const { main } = await import('./main')
      await main(
        [
          '--data-dir',
          dataDir,
          '--split',
          'benchmark',
          '--chat-model',
          'openai/gpt-4o-mini',
          '--tenant-concurrency',
          '2',
          '--enrich-concurrency',
          '1',
          '--answer',
          'ask',
          '--all',
          '--dry-run',
        ],
        (line) => lines.push(line),
      )
      expect(lines.join('\n')).toMatch(/captures: 10/)
    })
  })
})

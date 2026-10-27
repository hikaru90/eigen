import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HOOKS_DIR = join(import.meta.dirname, '..', '.githooks')

/**
 * Runs a hook with a fake `npm` first on PATH that records the environment it was started with.
 * `inherited` is what git exports to hooks; nothing here points at a real repository.
 */
function runHookWithFakeNpm(hook: string, dir: string, inherited: Record<string, string>) {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const envDump = join(dir, 'npm-env.txt')
  const argsDump = join(dir, 'npm-args.txt')
  writeFileSync(
    join(bin, 'npm'),
    `#!/usr/bin/env bash\nenv > "${envDump}"\necho "$@" > "${argsDump}"\n`,
    { mode: 0o755 },
  )
  execFileSync('bash', [join(HOOKS_DIR, hook)], {
    cwd: dir,
    env: { ...process.env, ...inherited, PATH: `${bin}:${process.env.PATH}` },
    stdio: 'pipe',
  })
  return {
    npmEnvNames: readFileSync(envDump, 'utf8')
      .split('\n')
      .map((line) => line.split('=')[0])
      .filter((name) => name.startsWith('GIT_')),
    npmArgs: readFileSync(argsDump, 'utf8').trim(),
  }
}

describe('.githooks/pre-push', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eigen-hook-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs the CI gate without the GIT_ environment git hands to hooks', () => {
    const inherited = {
      GIT_DIR: join(dir, 'victim.git'),
      GIT_WORK_TREE: join(dir, 'victim'),
      GIT_INDEX_FILE: join(dir, 'victim.git', 'index'),
      GIT_PREFIX: '',
      GIT_COMMON_DIR: join(dir, 'common.git'),
      GIT_OBJECT_DIRECTORY: join(dir, 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(dir, 'alternates'),
      GIT_NAMESPACE: 'ns',
      GIT_CEILING_DIRECTORIES: dir,
      GIT_EXEC_PATH: '/usr/lib/git-core',
      GIT_PUSH_OPTION_COUNT: '0',
    }

    const { npmEnvNames, npmArgs } = runHookWithFakeNpm('pre-push', dir, inherited)

    expect(npmArgs).toBe('run ci:local')
    expect(npmEnvNames).toEqual([])
  })
})

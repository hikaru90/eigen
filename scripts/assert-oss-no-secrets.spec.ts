import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVictimRepo } from './git-env-test-support.mjs'
import { isolatedGitEnv } from './isolated-git-env.mjs'
import { OSS_OPERATOR_SECRET_KEYS, parseEnvExampleValue } from './oss-operator-secret-keys.mjs'

describe('parseEnvExampleValue', () => {
  it('parses quoted and unquoted empty values', () => {
    expect(parseEnvExampleValue('LLM_API_KEY=""')).toBe('')
    expect(parseEnvExampleValue("LLM_API_KEY=''")).toBe('')
    expect(parseEnvExampleValue('LLM_API_KEY=')).toBe('')
  })

  it('parses non-empty quoted values', () => {
    expect(parseEnvExampleValue('LLM_API_KEY="secret"')).toBe('secret')
  })
})

describe('assert-oss-no-secrets', () => {
  const scriptsDir = import.meta.dirname
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eigen-oss-secrets-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  /**
   * A throwaway repo in `dir` that carries a copy of the guard. `.env.example` is clean unless
   * `llmApiKeyLine` replaces the `LLM_API_KEY` line; `extraTracked` adds more tracked files.
   * Every `git` call goes through `isolatedGitEnv()`: a hook-run test process has GIT_DIR set to
   * the pushing repository, which a bare `git init` would re-initialise.
   */
  function createGuardRepo(
    dir: string,
    options: { llmApiKeyLine?: string; extraTracked?: Record<string, string> } = {},
  ) {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    const envExample = OSS_OPERATOR_SECRET_KEYS.map((key) =>
      key === 'LLM_API_KEY' ? (options.llmApiKeyLine ?? 'LLM_API_KEY=""') : `${key}=""`,
    ).join('\n')
    writeFileSync(join(dir, '.env.example'), `${envExample}\n`)
    writeFileSync(join(dir, '.dockerignore'), '.env\n')
    writeFileSync(join(dir, 'docker-compose.yaml'), 'services: {}\n')
    writeFileSync(join(dir, 'Dockerfile'), 'FROM scratch\n')
    writeFileSync(join(dir, 'scripts', 'upload-posthog-sourcemaps.mjs'), 'export {}\n')
    for (const [path, content] of Object.entries(options.extraTracked ?? {})) {
      writeFileSync(join(dir, path), content)
    }
    execFileSync('git', ['init'], { cwd: dir, env: isolatedGitEnv(), stdio: 'pipe' })
    execFileSync('git', ['add', '.'], { cwd: dir, env: isolatedGitEnv(), stdio: 'pipe' })
    for (const file of [
      'assert-oss-no-secrets.mjs',
      'oss-operator-secret-keys.mjs',
      'isolated-git-env.mjs',
    ]) {
      writeFileSync(join(dir, 'scripts', file), readFileSync(join(scriptsDir, file), 'utf8'))
    }
  }

  function runGuard(cwd: string, env: NodeJS.ProcessEnv) {
    try {
      execFileSync('node', ['scripts/assert-oss-no-secrets.mjs'], { cwd, env, stdio: 'pipe' })
      return { failed: false, stderr: '' }
    } catch (error) {
      return { failed: true, stderr: String((error as { stderr?: Buffer }).stderr ?? '') }
    }
  }

  it('passes on the current repository', () => {
    expect(runGuard(join(scriptsDir, '..'), isolatedGitEnv())).toEqual({
      failed: false,
      stderr: '',
    })
  })

  it('fails when .env.example contains an operator API key', () => {
    createGuardRepo(root, { llmApiKeyLine: 'LLM_API_KEY="phc_test_should_fail"' })

    const result = runGuard(root, isolatedGitEnv())

    expect(result.failed).toBe(true)
    expect(result.stderr).toContain('.env.example must not ship LLM_API_KEY')
  })

  it('judges its own repo, and leaves the repo GIT_DIR points at alone, when run from a git hook', () => {
    const victim = createVictimRepo(root)
    const before = victim.snapshot()
    const guardRepo = join(root, 'guard-repo')
    // Only a `git ls-files` that runs in the guard repo can see this tracked leak.
    const leak = `const key = "${'sk-'}${'a'.repeat(24)}"\n`

    // The fixture setup below and the guard process both inherit the hook's environment.
    for (const [key, value] of Object.entries(victim.poisonedEnv)) {
      if (key.startsWith('GIT_') && value !== undefined) vi.stubEnv(key, value)
    }
    createGuardRepo(guardRepo, { extraTracked: { 'leak.txt': leak } })
    const result = runGuard(guardRepo, process.env)

    expect(result.failed).toBe(true)
    expect(result.stderr).toContain('leak.txt matches forbidden key pattern')
    expect(victim.snapshot()).toEqual(before)
  })
})

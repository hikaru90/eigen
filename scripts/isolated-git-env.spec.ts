import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVictimRepo } from './git-env-test-support.mjs'
import { isolatedGitEnv } from './isolated-git-env.mjs'

/** Everything that points git at a repository or changes where it reads/writes. */
const REPOSITORY_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
]

describe('isolatedGitEnv', () => {
  it('drops every GIT_ variable that points git at a repository', () => {
    const env = Object.fromEntries(REPOSITORY_VARS.map((key) => [key, `/some/${key}`]))
    expect(isolatedGitEnv({ ...env, PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' })
  })

  it('drops other GIT_ variables too, whatever their name', () => {
    const env = {
      GIT_CONFIG_COUNT: '1',
      GIT_SSH_COMMAND: 'ssh -i key',
      GIT_AUTHOR_NAME: 'someone',
      GIT_SOMETHING_NEW_IN_FUTURE_GIT: 'x',
      HOME: '/home/me',
    }
    expect(isolatedGitEnv(env)).toEqual({ HOME: '/home/me' })
  })

  it('keeps variables that are not git ones, including look-alikes', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/me',
      DIGIT_DIR: 'x',
      MY_GIT_DIR: 'y',
      GITHUB_TOKEN: 'z',
    }
    expect(isolatedGitEnv(env)).toEqual(env)
  })

  it('keeps exactly the GIT_ names the caller lists', () => {
    const env = { GIT_DIR: '/a', GIT_TERMINAL_PROMPT: '0', PATH: '/usr/bin' }
    expect(isolatedGitEnv(env, { keep: ['GIT_TERMINAL_PROMPT'] })).toEqual({
      GIT_TERMINAL_PROMPT: '0',
      PATH: '/usr/bin',
    })
  })

  it('does not mutate the env it is given', () => {
    const env = { GIT_DIR: '/a', PATH: '/usr/bin' }
    isolatedGitEnv(env)
    expect(env).toEqual({ GIT_DIR: '/a', PATH: '/usr/bin' })
  })

  it('defaults to process.env', () => {
    const before = process.env.GIT_DIR
    process.env.GIT_DIR = '/should/not/leak'
    try {
      expect(isolatedGitEnv()).not.toHaveProperty('GIT_DIR')
      expect(isolatedGitEnv()).toHaveProperty('PATH', process.env.PATH)
    } finally {
      if (before === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = before
    }
  })
})

/**
 * The pre-push incident: git runs hooks with GIT_DIR set to the pushing repository, so a test that
 * runs `git init` + `git add .` in a temp dir re-initialised that repository (core.bare = true)
 * and staged deletions of its tracked files. The victim here is a temp repo, never a real one.
 */
describe('git setup under an environment inherited from a git hook', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eigen-git-env-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function makeWorkDir() {
    const work = join(root, 'work')
    mkdirSync(work)
    writeFileSync(join(work, 'work.txt'), 'work\n')
    return work
  }

  function initAndAdd(cwd: string, env: NodeJS.ProcessEnv) {
    execFileSync('git', ['init'], { cwd, env, stdio: 'pipe' })
    execFileSync('git', ['add', '.'], { cwd, env, stdio: 'pipe' })
  }

  it('control: without isolation the same commands rewrite the repository GIT_DIR points at', () => {
    const victim = createVictimRepo(root)
    const before = victim.snapshot()
    expect(before.bare).toBe('false')

    initAndAdd(makeWorkDir(), victim.poisonedEnv)

    const after = victim.snapshot()
    expect(after.bare).toBe('true')
    expect(after.index).not.toBe(before.index)
  })

  it('leaves the repository GIT_DIR points at untouched and works in the temp dir', () => {
    const victim = createVictimRepo(root)
    const before = victim.snapshot()
    const work = makeWorkDir()
    const env = isolatedGitEnv(victim.poisonedEnv)

    initAndAdd(work, env)

    expect(victim.snapshot()).toEqual(before)
    expect(existsSync(join(work, '.git'))).toBe(true)
    const staged = execFileSync('git', ['ls-files'], { cwd: work, env, encoding: 'utf8' })
    expect(staged.trim()).toBe('work.txt')
  })
})

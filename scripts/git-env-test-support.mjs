/**
 * Test support: a throwaway "victim" repository standing in for the real repository that git
 * hooks point `GIT_DIR` at, plus the poisoned environment a hook-run test process inherits.
 *
 * The victim mirrors the real incident: a push from a linked worktree runs the hook with
 * `GIT_DIR=<main>/.git/worktrees/<name>`. A `git init` under that GIT_DIR guesses "bare" (its
 * name is not `.git`) and writes `core.bare = true` into the shared config of the main repository.
 *
 * Everything lives under a temp directory the caller owns. The real repository is never touched.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isolatedGitEnv } from './isolated-git-env.mjs'

/**
 * @typedef {{ config: string, index: string, bare: string }} VictimSnapshot
 * @typedef {{
 *   mainDir: string,
 *   worktree: string,
 *   gitDir: string,
 *   poisonedEnv: NodeJS.ProcessEnv,
 *   snapshot: () => VictimSnapshot,
 * }} VictimRepo
 */

/**
 * Creates `<dir>/victim-main` (one commit) with a linked worktree `<dir>/victim`.
 * `poisonedEnv` is `process.env` plus what git exports to a hook running in that worktree.
 * `snapshot()` reads the shared config, the worktree's raw index bytes and `core.bare` without
 * repository discovery, so it also works after the repository was flipped to bare.
 *
 * @param {string} dir
 * @returns {VictimRepo}
 */
export function createVictimRepo(dir) {
  const mainDir = join(dir, 'victim-main')
  const worktree = join(dir, 'victim')
  mkdirSync(mainDir, { recursive: true })

  /** @param {string} cwd @param {string[]} args */
  const git = (cwd, args) =>
    execFileSync('git', args, { cwd, env: isolatedGitEnv(), stdio: 'pipe', encoding: 'utf8' })

  git(mainDir, ['init'])
  writeFileSync(join(mainDir, 'tracked.txt'), 'tracked\n')
  git(mainDir, ['add', 'tracked.txt'])
  git(mainDir, [
    '-c',
    'user.name=victim',
    '-c',
    'user.email=victim@example.invalid',
    'commit',
    '--no-verify',
    '--no-gpg-sign',
    '-m',
    'victim',
  ])
  git(mainDir, ['worktree', 'add', '-b', 'victim', worktree])

  const gitDir = git(worktree, ['rev-parse', '--absolute-git-dir']).trim()
  const sharedConfig = join(mainDir, '.git', 'config')

  return {
    mainDir,
    worktree,
    gitDir,
    poisonedEnv: {
      ...process.env,
      GIT_DIR: gitDir,
      GIT_INDEX_FILE: join(gitDir, 'index'),
      GIT_PREFIX: '',
    },
    snapshot() {
      return {
        config: readFileSync(sharedConfig, 'utf8'),
        index: readFileSync(join(gitDir, 'index')).toString('hex'),
        bare: git(dir, ['config', '--file', sharedConfig, '--get', 'core.bare']).trim(),
      }
    },
  }
}

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runNpmPrepare } from './npm-prepare.mjs'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('npm-prepare', () => {
  it('exits cleanly when svelte config, project.inlang, and git hooks are absent (Docker deps stage)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eigen-npm-prepare-'))
    mkdirSync(path.join(dir, 'scripts'), { recursive: true })
    const result = runNpmPrepare({ root: dir, run: () => undefined })
    expect(result).toEqual({
      svelteKitSync: 'skipped',
      paraglide: 'skipped',
      gitHooks: 'skipped',
    })
  })

  it('runs install-git-hooks only when the script and .git exist', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eigen-npm-prepare-hooks-'))
    mkdirSync(path.join(dir, 'scripts'), { recursive: true })
    mkdirSync(path.join(dir, '.git'), { recursive: true })
    writeFileSync(path.join(dir, 'scripts', 'install-git-hooks.mjs'), 'export {}\n')

    const ran: string[] = []
    runNpmPrepare({
      root: dir,
      run: (command, args) => {
        ran.push([command, ...args].join(' '))
      },
    })

    expect(ran).toEqual(['node scripts/install-git-hooks.mjs'])
  })

  it('does not throw when invoked against the real repo root with dry-run runner', () => {
    expect(() =>
      runNpmPrepare({
        root: repoRoot,
        run: () => undefined,
      }),
    ).not.toThrow()
  })
})

#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hooksDir = join(root, '.githooks')
const prePush = join(hooksDir, 'pre-push')

if (!existsSync(prePush)) {
  console.warn('[install-git-hooks] missing .githooks/pre-push — skip')
  process.exit(0)
}

chmodSync(prePush, 0o755)

try {
  const current = execSync('git config --get core.hooksPath', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (current === '.githooks') {
    process.exit(0)
  }
} catch {
  // not set
}

execSync('git config core.hooksPath .githooks', { cwd: root, stdio: 'inherit' })
console.info('[install-git-hooks] core.hooksPath → .githooks')

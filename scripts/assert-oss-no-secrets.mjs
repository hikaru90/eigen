#!/usr/bin/env node
/**
 * Fail fast when open-source artifacts would ship operator API keys or hardcoded project IDs.
 * Run in CI and before release: `npm run assert:oss-secrets`
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OSS_FORBIDDEN_KEY_PATTERNS,
  OSS_OPERATOR_SECRET_KEYS,
  parseEnvExampleValue,
} from './oss-operator-secret-keys.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @type {string[]} */
const errors = []

function fail(message) {
  errors.push(message)
}

function readTrackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
  } catch {
    fail('git ls-files failed — run from a git checkout')
    return []
  }
}

function assertEnvExampleHasNoOperatorSecrets() {
  const envExamplePath = join(repoRoot, '.env.example')
  const content = readFileSync(envExamplePath, 'utf8')
  const lines = content.split('\n')

  for (const key of OSS_OPERATOR_SECRET_KEYS) {
    const line = lines.find((entry) => entry.startsWith(`${key}=`))
    if (!line) continue
    const value = parseEnvExampleValue(line)
    if (value) {
      fail(`.env.example must not ship ${key} (found non-empty value)`)
    }
  }
}

function assertNoForbiddenKeyMaterialInTrackedFiles(files) {
  const skipSuffixes = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.pdf']
  const skipPaths = new Set(['package-lock.json'])

  for (const relPath of files) {
    if (skipPaths.has(relPath)) continue
    if (skipSuffixes.some((suffix) => relPath.endsWith(suffix))) continue
    if (relPath === '.env' || relPath.startsWith('.env.')) continue

    const absPath = join(repoRoot, relPath)
    let content
    try {
      content = readFileSync(absPath, 'utf8')
    } catch {
      continue
    }

    for (const pattern of OSS_FORBIDDEN_KEY_PATTERNS) {
      if (pattern.test(content)) {
        fail(`${relPath} matches forbidden key pattern ${pattern}`)
      }
    }
  }
}

function assertNoHardcodedPostHogProjectId(files) {
  const targets = files.filter((path) =>
    ['docker-compose.yaml', 'Dockerfile', 'scripts/upload-posthog-sourcemaps.mjs'].includes(path),
  )

  for (const relPath of targets) {
    const content = readFileSync(join(repoRoot, relPath), 'utf8')
    if (/\b208285\b/.test(content)) {
      fail(`${relPath} must not hardcode operator PostHog project id 208285`)
    }
  }
}

function assertDockerIgnoreExcludesEnv() {
  const dockerIgnore = readFileSync(join(repoRoot, '.dockerignore'), 'utf8')
  if (!/^\.env$/m.test(dockerIgnore)) {
    fail(
      '.dockerignore must exclude .env so local API keys are not copied into image build context',
    )
  }
}

assertEnvExampleHasNoOperatorSecrets()
const tracked = readTrackedFiles()
assertNoForbiddenKeyMaterialInTrackedFiles(tracked)
assertNoHardcodedPostHogProjectId(tracked)
assertDockerIgnoreExcludesEnv()

if (errors.length > 0) {
  console.error('[oss-secrets] Open-source secret checks failed:\n')
  for (const message of errors) {
    console.error(`  - ${message}`)
  }
  process.exit(1)
}

console.log('[oss-secrets] OK — no operator API keys in tracked OSS artifacts')

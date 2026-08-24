import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  it('passes on the current repository', () => {
    expect(() =>
      execFileSync('node', ['scripts/assert-oss-no-secrets.mjs'], {
        cwd: join(import.meta.dirname, '..'),
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })

  it('fails when .env.example contains an operator API key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigen-oss-secrets-'))
    try {
      const envExample = OSS_OPERATOR_SECRET_KEYS.map((key) =>
        key === 'LLM_API_KEY' ? 'LLM_API_KEY="phc_test_should_fail"' : `${key}=""`,
      ).join('\n')
      writeFileSync(join(dir, '.env.example'), `${envExample}\n`)
      writeFileSync(join(dir, '.dockerignore'), '.env\n')
      writeFileSync(join(dir, 'docker-compose.yaml'), 'services: {}\n')
      writeFileSync(join(dir, 'Dockerfile'), 'FROM scratch\n')
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'upload-posthog-sourcemaps.mjs'), 'export {}\n')
      execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' })
      const script = readFileSync(join(import.meta.dirname, 'assert-oss-no-secrets.mjs'), 'utf8')
      writeFileSync(join(dir, 'scripts', 'assert-oss-no-secrets.mjs'), script)
      writeFileSync(
        join(dir, 'scripts', 'oss-operator-secret-keys.mjs'),
        readFileSync(join(import.meta.dirname, 'oss-operator-secret-keys.mjs'), 'utf8'),
      )

      expect(() =>
        execFileSync('node', ['scripts/assert-oss-no-secrets.mjs'], { cwd: dir, stdio: 'pipe' }),
      ).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isEnvValuePresent, setEnvVarInFile } from './env-file.mjs'

describe('isEnvValuePresent', () => {
  it('treats empty and whitespace as missing', () => {
    expect(isEnvValuePresent('')).toBe(false)
    expect(isEnvValuePresent('   ')).toBe(false)
    expect(isEnvValuePresent(undefined)).toBe(false)
  })

  it('accepts non-empty values', () => {
    expect(isEnvValuePresent('abc')).toBe(true)
  })
})

describe('setEnvVarInFile', () => {
  it('replaces existing keys and escapes quotes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigen-env-'))
    const envPath = join(dir, '.env')
    writeFileSync(envPath, 'VAPID_PUBLIC_KEY="old"\n', 'utf8')

    setEnvVarInFile('VAPID_PUBLIC_KEY', 'new"key', envPath)

    expect(readFileSync(envPath, 'utf8')).toBe('VAPID_PUBLIC_KEY="new\\"key"\n')
  })

  it('appends missing keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eigen-env-'))
    const envPath = join(dir, '.env')
    writeFileSync(envPath, 'ORIGIN="https://example.com"\n', 'utf8')

    setEnvVarInFile('ADMIN_CONSOLIDATION_KEY', 'secret', envPath)

    expect(readFileSync(envPath, 'utf8')).toBe(
      'ORIGIN="https://example.com"\n\nADMIN_CONSOLIDATION_KEY="secret"\n',
    )
  })
})

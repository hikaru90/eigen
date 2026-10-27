import { describe, expect, it } from 'vitest'
import { SMOKE_USAGE, SmokeUsageError, parseSmokeArgs } from './cli'

describe('parseSmokeArgs', () => {
  it('resets the tenant by default', () => {
    expect(parseSmokeArgs([])).toEqual({ keep: false, help: false })
  })

  it('--keep skips the reset', () => {
    expect(parseSmokeArgs(['--keep'])).toEqual({ keep: true, help: false })
  })

  it('--help and -h ask for the usage', () => {
    expect(parseSmokeArgs(['--help']).help).toBe(true)
    expect(parseSmokeArgs(['-h']).help).toBe(true)
  })

  it('rejects an unknown argument loudly', () => {
    expect(() => parseSmokeArgs(['--fresh'])).toThrow(SmokeUsageError)
    expect(() => parseSmokeArgs(['--fresh'])).toThrow(/unknown argument "--fresh"/)
    expect(() => parseSmokeArgs(['keep'])).toThrow(/unknown argument "keep"/)
  })

  it('rejects --keep given twice', () => {
    expect(() => parseSmokeArgs(['--keep', '--keep'])).toThrow(/--keep given more than once/)
  })
})

describe('SMOKE_USAGE', () => {
  it('names the command, the flag and the exit codes', () => {
    expect(SMOKE_USAGE).toContain('npm run capture-review:smoke')
    expect(SMOKE_USAGE).toContain('--keep')
    expect(SMOKE_USAGE).toMatch(/exit code/i)
  })
})

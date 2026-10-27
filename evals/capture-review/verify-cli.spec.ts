import { describe, expect, it } from 'vitest'
import { parseVerifyArgs, VERIFY_USAGE, VerifyUsageError } from './verify-cli'

describe('parseVerifyArgs', () => {
  it('resets the tenant by default', () => {
    expect(parseVerifyArgs([])).toEqual({ keep: false, help: false })
  })

  it('--keep skips the reset; --help and -h ask for the usage', () => {
    expect(parseVerifyArgs(['--keep'])).toEqual({ keep: true, help: false })
    expect(parseVerifyArgs(['--help']).help).toBe(true)
    expect(parseVerifyArgs(['-h']).help).toBe(true)
  })

  it('rejects an unknown argument and a repeated --keep loudly', () => {
    expect(() => parseVerifyArgs(['--fresh'])).toThrow(VerifyUsageError)
    expect(() => parseVerifyArgs(['--fresh'])).toThrow(/unknown argument "--fresh"/)
    expect(() => parseVerifyArgs(['--keep', '--keep'])).toThrow(/more than once/)
  })
})

describe('VERIFY_USAGE', () => {
  it('names the command, the flags and the exit codes', () => {
    expect(VERIFY_USAGE).toContain('npm run capture-review:verify')
    expect(VERIFY_USAGE).toContain('--keep')
    expect(VERIFY_USAGE).toMatch(/exit code/i)
  })
})

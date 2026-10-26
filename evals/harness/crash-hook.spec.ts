import { describe, expect, it, vi } from 'vitest'
import {
  createCallAccounting,
  parseCrashSpec,
  refuseCrashHook,
  resolveCrashSpec,
} from './crash-hook'

const paid = { kind: 'paid', endpoint: 'chat', usd: 0.01 } as const
const hit = { kind: 'hit', endpoint: 'chat', usd: 0.01 } as const

describe('parseCrashSpec', () => {
  it('parses <phase>:<n>', () => {
    expect(parseCrashSpec('ingest:15')).toEqual({ phase: 'ingest', n: 15 })
    expect(parseCrashSpec('answer:3')).toEqual({ phase: 'answer', n: 3 })
  })

  it('is null when unset or blank', () => {
    expect(parseCrashSpec(undefined)).toBeNull()
    expect(parseCrashSpec('  ')).toBeNull()
  })

  it.each([
    'ingest',
    'ingest:0',
    'ingest:-1',
    'ingest:1.5',
    'enrich:3',
    ':3',
    'answer:x',
    'ingest:3:4',
  ])('rejects %s', (raw) => {
    expect(() => parseCrashSpec(raw)).toThrow(/EVAL_CRASH_AT/)
  })
})

describe('arming', () => {
  it('arms from the environment inside the eval CLI', () => {
    expect(resolveCrashSpec({ EVAL_CRASH_AT: 'ingest:2' })).toEqual({ phase: 'ingest', n: 2 })
    expect(resolveCrashSpec({})).toBeNull()
  })

  it('refuses in production', () => {
    expect(() => resolveCrashSpec({ EVAL_CRASH_AT: 'ingest:2', NODE_ENV: 'production' })).toThrow(
      /production/,
    )
  })

  it('refuseCrashHook rejects an entry point that does not support it', () => {
    expect(() => refuseCrashHook({ EVAL_CRASH_AT: 'ingest:2' }, 'longmemeval')).toThrow(
      /EVAL_CRASH_AT.*longmemeval.*PersonaMem/s,
    )
    expect(() => refuseCrashHook({}, 'longmemeval')).not.toThrow()
  })
})

describe('call accounting and the crash', () => {
  it('counts paid calls and cache hits per phase', async () => {
    const accounting = createCallAccounting({ crash: null, kill: vi.fn(), onCrash: vi.fn() })
    await accounting.withPhase('ingest', async () => {
      accounting.observe(paid)
      accounting.observe(hit)
      accounting.observe(hit)
    })
    await accounting.withPhase('answer', async () => accounting.observe(paid))
    accounting.observe(paid)
    expect(accounting.counters()).toEqual({
      ingest: { paid: 1, hits: 2 },
      answer: { paid: 1, hits: 0 },
      other: { paid: 1, hits: 0 },
    })
  })

  it('kills the process right after the n-th paid call of the armed phase', async () => {
    const kill = vi.fn()
    const onCrash = vi.fn()
    const accounting = createCallAccounting({ crash: { phase: 'ingest', n: 3 }, kill, onCrash })
    await accounting.withPhase('ingest', async () => {
      accounting.observe(paid)
      accounting.observe(hit)
      accounting.observe(paid)
      expect(kill).not.toHaveBeenCalled()
      accounting.observe(paid)
    })
    expect(onCrash).toHaveBeenCalledWith({ phase: 'ingest', n: 3, counters: expect.anything() })
    expect(kill).toHaveBeenCalledTimes(1)
    // the crash is reported before the kill
    expect(onCrash.mock.invocationCallOrder[0]!).toBeLessThan(kill.mock.invocationCallOrder[0]!)
  })

  it('ignores paid calls of another phase and cache hits', async () => {
    const kill = vi.fn()
    const accounting = createCallAccounting({
      crash: { phase: 'answer', n: 1 },
      kill,
      onCrash: vi.fn(),
    })
    await accounting.withPhase('ingest', async () => {
      accounting.observe(paid)
      accounting.observe(paid)
    })
    await accounting.withPhase('answer', async () => accounting.observe(hit))
    expect(kill).not.toHaveBeenCalled()
    await accounting.withPhase('answer', async () => accounting.observe(paid))
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('never kills when no crash is armed', async () => {
    const kill = vi.fn()
    const accounting = createCallAccounting({ crash: null, kill, onCrash: vi.fn() })
    await accounting.withPhase('ingest', async () => {
      for (let i = 0; i < 50; i++) accounting.observe(paid)
    })
    expect(kill).not.toHaveBeenCalled()
  })

  it('phases are tracked per async context, so parallel tenants do not mix', async () => {
    const accounting = createCallAccounting({ crash: null, kill: vi.fn(), onCrash: vi.fn() })
    await Promise.all([
      accounting.withPhase('ingest', async () => {
        await new Promise((r) => setTimeout(r, 5))
        accounting.observe(paid)
      }),
      accounting.withPhase('answer', async () => {
        accounting.observe(paid)
        accounting.observe(paid)
      }),
    ])
    expect(accounting.counters()).toMatchObject({
      ingest: { paid: 1 },
      answer: { paid: 2 },
    })
  })
})

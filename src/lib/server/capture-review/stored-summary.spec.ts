import type { CaptureAuditInput } from './audit-questions'
import { describe, expect, it } from 'vitest'
import { buildStoredSummary } from './stored-summary'

const AUDIT: CaptureAuditInput = {
  capturedAt: '2026-10-27T10:00:00+01:00',
  timezone: 'Europe/Berlin',
  rawText: 'Dentist Friday at 9, ask Anna about the invoice',
  storedText: 'Dentist Friday at 9, ask Anna about the invoice',
  names: [],
  dates: [],
  pieces: [],
}

function audit(patch: Partial<CaptureAuditInput> = {}): CaptureAuditInput {
  return { ...AUDIT, ...patch }
}

describe('buildStoredSummary (how Eigen stored a capture, in plain words, no model)', () => {
  it('is only the category when nothing else was found', () => {
    expect(buildStoredSummary({ category: 'task', audit: audit() })).toBe('Saved as Task')
  })

  it('prettifies the category key the way the kept strip shows it', () => {
    expect(buildStoredSummary({ category: 'open_question', audit: audit() })).toBe(
      'Saved as Open question',
    )
  })

  it('adds the names, in the order they were found', () => {
    expect(
      buildStoredSummary({
        category: 'task',
        audit: audit({
          names: [
            { ref: 'n1', surface: 'Anna' },
            { ref: 'n2', surface: 'Studio Nord' },
          ],
        }),
      }),
    ).toBe('Saved as Task · about Anna, Studio Nord')
  })

  it('adds the stored dates as the date question words them, several joined by "; "', () => {
    expect(
      buildStoredSummary({
        category: 'event',
        audit: audit({
          dates: [
            { ref: 'd1', event: 'Dentist', day: '2026-10-30', detail: 'at 09:00' },
            { ref: 'd2', event: 'Yoga', day: null, detail: 'every Tuesday at 19:00' },
          ],
        }),
      }),
    ).toBe(
      'Saved as Event · Dentist: the Friday after the capture day (3 days later) at 09:00, once (not repeating); Yoga: every Tuesday at 19:00',
    )
  })

  it('says how many thoughts a split capture became', () => {
    expect(
      buildStoredSummary({
        category: 'task',
        audit: audit({
          pieces: [
            { ref: 'p1', text: 'Dentist Friday at 9' },
            { ref: 'p2', text: 'Ask Anna about the invoice' },
            { ref: 'p3', text: 'Buy stamps' },
          ],
        }),
      }),
    ).toBe('Saved as Task · split into 3 thoughts')
  })

  it('puts the parts in a fixed order: category, names, dates, split', () => {
    expect(
      buildStoredSummary({
        category: 'task',
        audit: audit({
          names: [{ ref: 'n1', surface: 'Anna' }],
          dates: [{ ref: 'd1', event: 'Dentist', day: '2026-10-27', detail: null }],
          pieces: [
            { ref: 'p1', text: 'one' },
            { ref: 'p2', text: 'two' },
          ],
        }),
      }),
    ).toBe(
      'Saved as Task · about Anna · Dentist: the capture day itself, once (not repeating) · split into 2 thoughts',
    )
  })

  it('is the same for the same stored state, whatever the language of the capture', () => {
    const german = audit({
      rawText: 'Morgen Oma anrufen',
      storedText: 'Morgen Oma anrufen',
      names: [{ ref: 'n1', surface: 'Oma' }],
    })
    expect(buildStoredSummary({ category: 'task', audit: german })).toBe(
      buildStoredSummary({ category: 'task', audit: german }),
    )
    expect(buildStoredSummary({ category: 'task', audit: german })).toBe('Saved as Task · about Oma')
  })

  it('never carries the capture text or the stored text', () => {
    const summary = buildStoredSummary({
      category: 'task',
      audit: audit({ names: [{ ref: 'n1', surface: 'Anna' }] }),
    })
    expect(summary).not.toContain('Dentist')
    expect(summary).not.toContain('invoice')
  })

  it('fails loudly on an empty category', () => {
    expect(() => buildStoredSummary({ category: '  ', audit: audit() })).toThrow(
      'category must not be empty',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { SMOKE_FIXTURE_PATH, loadSmokeFixture, parseSmokeFixture } from './fixture'

const valid = [
  { text: 'Call Mom on Friday', capturedAt: '2026-10-27T10:00:00+01:00' },
  { text: 'Dentist at 9', capturedAt: '2026-10-27T09:00:00Z' },
]

describe('parseSmokeFixture', () => {
  it('reads a list of captures, in order, with the capture time as a Date', () => {
    const captures = parseSmokeFixture(valid)
    expect(captures).toHaveLength(2)
    expect(captures[0]).toEqual({
      text: 'Call Mom on Friday',
      capturedAt: '2026-10-27T10:00:00+01:00',
      capturedAtDate: new Date('2026-10-27T09:00:00.000Z'),
    })
    expect(captures[1].capturedAtDate.toISOString()).toBe('2026-10-27T09:00:00.000Z')
  })

  it('accepts fractional seconds and negative offsets', () => {
    const [capture] = parseSmokeFixture([
      { text: 'x', capturedAt: '2026-10-27T10:00:00.250-05:00' },
    ])
    expect(capture.capturedAtDate.toISOString()).toBe('2026-10-27T15:00:00.250Z')
  })

  it('keeps the text exactly as written (a capture is what the user typed)', () => {
    const [capture] = parseSmokeFixture([
      { text: '  Am Mittwoch mit Papa zum Arzt  ', capturedAt: '2026-10-27T10:00:00+01:00' },
    ])
    expect(capture.text).toBe('  Am Mittwoch mit Papa zum Arzt  ')
  })

  it('rejects anything but a non-empty list', () => {
    expect(() => parseSmokeFixture({})).toThrow(/list/)
    expect(() => parseSmokeFixture('captures')).toThrow(/list/)
    expect(() => parseSmokeFixture(null)).toThrow(/list/)
    expect(() => parseSmokeFixture([])).toThrow(/at least one capture/)
  })

  it('rejects a capture that is not exactly { text, capturedAt }', () => {
    expect(() => parseSmokeFixture(['Call Mom'])).toThrow(/capture 1/)
    expect(() =>
      parseSmokeFixture([{ text: 'x', capturedAt: '2026-10-27T10:00:00+01:00', note: 'y' }]),
    ).toThrow(/capture 1/)
    expect(() => parseSmokeFixture([{ text: 'x' }])).toThrow(/capture 1/)
    expect(() => parseSmokeFixture([{ capturedAt: '2026-10-27T10:00:00+01:00' }])).toThrow(
      /capture 1/,
    )
  })

  it('rejects a blank or non-string text, naming the capture', () => {
    expect(() =>
      parseSmokeFixture([valid[0], { text: '   ', capturedAt: '2026-10-27T10:00:00+01:00' }]),
    ).toThrow(/capture 2.*text/)
    expect(() => parseSmokeFixture([{ text: 7, capturedAt: '2026-10-27T10:00:00+01:00' }])).toThrow(
      /capture 1/,
    )
  })

  it('rejects a capture time without an offset, or that is not a real date-time', () => {
    for (const capturedAt of [
      '2026-10-27T10:00:00',
      '2026-10-27',
      '10:00',
      'yesterday',
      '2026-13-40T10:00:00+01:00',
      '2026-02-30T10:00:00+01:00',
      '2026-10-27 10:00:00+01:00',
      '',
    ]) {
      expect(() => parseSmokeFixture([{ text: 'x', capturedAt }]), capturedAt).toThrow(
        /capture 1.*capturedAt/,
      )
    }
  })
})

describe('the shipped smoke fixture (evals/capture-review/smoke.json)', () => {
  const captures = loadSmokeFixture(SMOKE_FIXTURE_PATH)

  it('holds exactly the seven planned captures, in order', () => {
    expect(captures.map((c) => c.text)).toEqual([
      'Call Mom on Friday about the birthday dinner',
      'Dentist appointment on Friday at 9am',
      'maybe ask Jonas if he wants to join the climbing trip',
      'Today: 1) send invoice to Kowalski GmbH 2) book train to Hamburg 3) water the plants',
      'Yoga every Tuesday at 7pm at Studio Nord',
      'Am Mittwoch mit Papa zum Arzt nach Leipzig fahren',
      'Work on the Eigen launch plan with Priya next week',
    ])
  })

  it('captures all of them on Tuesday 27 October 2026 at 10:00 (+01:00)', () => {
    for (const capture of captures) {
      expect(capture.capturedAt).toBe('2026-10-27T10:00:00+01:00')
      expect(capture.capturedAtDate.toISOString()).toBe('2026-10-27T09:00:00.000Z')
    }
  })
})

describe('loadSmokeFixture', () => {
  it('fails loudly on a file that is missing or not JSON', () => {
    expect(() => loadSmokeFixture('/nonexistent/smoke.json')).toThrow(/smoke fixture/)
  })
})

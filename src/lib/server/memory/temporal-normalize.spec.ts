import { describe, expect, it } from 'vitest'
import {
  applyCaptureAnchoredMentions,
  buildActivePeriodLiteral,
  parseTemporalMentions,
  resolveTemporalBounds,
} from './temporal-normalize'

describe('parseTemporalMentions', () => {
  it('parses valid temporal mentions and filters invalid kinds', () => {
    const out = parseTemporalMentions(
      `[
				{"surface":"due Friday","kind":"deadline","startAt":"2026-05-22T00:00:00.000Z","timePrecision":"day","timezone":"UTC","isAllDay":true,"confidence":0.9,"semanticSummary":"Report due Friday"},
				{"surface":"bad","kind":"not_a_kind","startAt":"2026-05-22T00:00:00.000Z","timePrecision":"day","timezone":"UTC","confidence":1,"semanticSummary":"x"}
			]`,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('deadline')
    expect(out[0]?.isAllDay).toBe(true)
  })

  it('throws when JSON is not an array', () => {
    expect(() => parseTemporalMentions('{}')).toThrow(/must be a JSON array/)
  })
})

describe('resolveTemporalBounds', () => {
  it('returns a half-open tsrange literal for a deadline', () => {
    const bounds = resolveTemporalBounds({
      surface: 'due Friday',
      kind: 'deadline',
      startAt: '2026-05-22T12:00:00.000Z',
      timePrecision: 'exact',
      timezone: 'UTC',
      isAllDay: false,
      confidence: 1,
      semanticSummary: 'Report due Friday',
    })
    expect(bounds.end.getTime()).toBeGreaterThan(bounds.start.getTime())
    expect(bounds.activePeriodLiteral).toMatch(/^\[.+,.+\)$/)
    expect(buildActivePeriodLiteral(bounds.start, bounds.end)).toBe(bounds.activePeriodLiteral)
  })

  it('uses a fuzzy window when endAt is omitted', () => {
    const bounds = resolveTemporalBounds({
      surface: 'sometime next month',
      kind: 'period',
      startAt: '2026-06-01T00:00:00.000Z',
      timePrecision: 'fuzzy',
      timezone: 'UTC',
      isAllDay: true,
      confidence: 0.7,
      semanticSummary: 'Vacation sometime next month',
    })
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('extends reminders and deadlines by one day when endAt is omitted', () => {
    const reminder = resolveTemporalBounds({
      surface: 'take meds',
      kind: 'reminder',
      startAt: '2026-06-01T08:00:00.000Z',
      timePrecision: 'exact',
      timezone: 'UTC',
      isAllDay: false,
      confidence: 1,
      semanticSummary: 'Take meds',
    })
    expect(reminder.end.getTime() - reminder.start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it.each([
    ['day', 24 * 60 * 60 * 1000],
    ['week', 7 * 24 * 60 * 60 * 1000],
    ['exact', 60 * 60 * 1000],
  ] as const)('uses %s precision window when endAt is omitted', (precision, windowMs) => {
    const bounds = resolveTemporalBounds({
      surface: 'event',
      kind: 'appointment',
      startAt: '2026-06-01T08:00:00.000Z',
      timePrecision: precision,
      timezone: 'UTC',
      isAllDay: precision === 'day',
      confidence: 1,
      semanticSummary: 'Event',
    })
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(windowMs)
  })

  it('uses month precision and honors explicit endAt', () => {
    const bounds = resolveTemporalBounds({
      surface: 'June sprint',
      kind: 'period',
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: '2026-07-01T00:00:00.000Z',
      timePrecision: 'month',
      timezone: 'UTC',
      isAllDay: true,
      confidence: 1,
      semanticSummary: 'June sprint',
    })
    expect(bounds.end.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('throws on invalid temporal instants', () => {
    expect(() =>
      resolveTemporalBounds({
        surface: 'bad',
        kind: 'deadline',
        startAt: 'not-a-date',
        timePrecision: 'exact',
        timezone: 'UTC',
        isAllDay: false,
        confidence: 1,
        semanticSummary: 'bad',
      }),
    ).toThrow(/Invalid temporal startAt/)
  })
})

describe('applyCaptureAnchoredMentions', () => {
  it('overrides startAt from relativeSpec', () => {
    const capturedAt = new Date('2023-05-28T07:17:00.000Z')
    const out = applyCaptureAnchoredMentions(
      parseTemporalMentions(
        `[{
					"surface":"two months ago",
					"kind":"appointment",
					"startAt":"2023-05-28T00:00:00.000Z",
					"timePrecision":"day",
					"timezone":"UTC",
					"confidence":1,
					"semanticSummary":"Data Analysis using Python webinar two months ago",
					"relativeSpec":{"dateAnchor":"capture_time","relativeMonthsPast":2}
				}]`,
      ),
      capturedAt,
    )
    expect(out[0]?.startAt.slice(0, 10)).toBe('2023-03-28')
  })
})

describe('parseTemporalMentions edge cases', () => {
  it('filters null entries and clamps confidence', () => {
    const out = parseTemporalMentions(
      `[
				null,
				{"surface":"  lunch  ","kind":"appointment","startAt":"2026-06-01T12:00:00.000Z","timePrecision":"exact","timezone":"UTC","confidence":4,"semanticSummary":"  Lunch meeting  "},
				{"surface":"x","kind":"appointment","startAt":"2026-06-01T12:00:00.000Z","timePrecision":"bad","timezone":"UTC","confidence":1,"semanticSummary":"x"}
			]`,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.surface).toBe('lunch')
    expect(out[0]?.confidence).toBe(1)
    expect(out[0]?.semanticSummary).toBe('Lunch meeting')
  })

  it('filters non-object entries and rows missing required fields', () => {
    const out = parseTemporalMentions(
      `[
				"not-an-object",
				42,
				{"surface":"","kind":"deadline","startAt":"2026-06-01T00:00:00.000Z","timePrecision":"day"},
				{"surface":"no start","kind":"deadline","startAt":"","timePrecision":"day"},
				{"surface":"no kind","startAt":"2026-06-01T00:00:00.000Z","timePrecision":"day"}
			]`,
    )
    expect(out).toEqual([])
  })

  it('applies defaults for optional fields and parses recurrenceRule', () => {
    const out = parseTemporalMentions(
      `[
				{
					"surface":"standup",
					"kind":"appointment",
					"startAt":"2026-06-01T09:00:00.000Z",
					"endAt":"   ",
					"recurrenceRule":" FREQ=WEEKLY ",
					"confidence":"not-a-number"
				}
			]`,
    )
    expect(out).toEqual([
      {
        surface: 'standup',
        kind: 'appointment',
        startAt: '2026-06-01T09:00:00.000Z',
        endAt: undefined,
        timePrecision: 'fuzzy',
        timezone: 'UTC',
        isAllDay: false,
        recurrenceRule: 'FREQ=WEEKLY',
        confidence: 0,
        semanticSummary: 'standup',
      },
    ])
  })

  it('falls back semanticSummary to surface when summary is blank', () => {
    const out = parseTemporalMentions(
      `[{"surface":"milestone day","kind":"milestone","startAt":"2026-06-15T00:00:00.000Z","timePrecision":"day","semanticSummary":"   "}]`,
    )
    expect(out[0]?.semanticSummary).toBe('milestone day')
  })

  it('accepts all allowed kinds and rejects invalid precision', () => {
    const out = parseTemporalMentions(
      `[
				{"surface":"a","kind":"period","startAt":"2026-06-01T00:00:00.000Z","timePrecision":"week"},
				{"surface":"b","kind":"inferred_event","startAt":"2026-06-02T00:00:00.000Z","timePrecision":"month"},
				{"surface":"c","kind":"appointment","startAt":"2026-06-03T00:00:00.000Z","timePrecision":"invalid"}
			]`,
    )
    expect(out.map((m) => m.kind)).toEqual(['period', 'inferred_event'])
  })

  it('treats non-string surface and startAt as empty', () => {
    const out = parseTemporalMentions(
      `[{"surface":123,"kind":"deadline","startAt":null,"timePrecision":"day"}]`,
    )
    expect(out).toEqual([])
  })
})

describe('resolveTemporalBounds additional branches', () => {
  it('throws on invalid endAt', () => {
    expect(() =>
      resolveTemporalBounds({
        surface: 'bad end',
        kind: 'period',
        startAt: '2026-06-01T00:00:00.000Z',
        endAt: 'not-a-date',
        timePrecision: 'exact',
        timezone: 'UTC',
        isAllDay: false,
        confidence: 1,
        semanticSummary: 'bad end',
      }),
    ).toThrow(/Invalid temporal endAt/)
  })

  it('uses month window when endAt is omitted', () => {
    const bounds = resolveTemporalBounds({
      surface: 'June',
      kind: 'period',
      startAt: '2026-06-01T00:00:00.000Z',
      timePrecision: 'month',
      timezone: 'UTC',
      isAllDay: false,
      confidence: 1,
      semanticSummary: 'June period',
    })
    expect(bounds.end.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('extends all-day exact events by one day', () => {
    const bounds = resolveTemporalBounds({
      surface: 'all day',
      kind: 'appointment',
      startAt: '2026-06-01T08:00:00.000Z',
      timePrecision: 'exact',
      timezone: 'UTC',
      isAllDay: true,
      confidence: 1,
      semanticSummary: 'All day event',
    })
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('extends end by one hour when endAt is not after start', () => {
    const bounds = resolveTemporalBounds({
      surface: 'same instant',
      kind: 'appointment',
      startAt: '2026-06-01T08:00:00.000Z',
      endAt: '2026-06-01T08:00:00.000Z',
      timePrecision: 'exact',
      timezone: 'UTC',
      isAllDay: false,
      confidence: 1,
      semanticSummary: 'Same instant',
    })
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(60 * 60 * 1000)
  })
})

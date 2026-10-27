import { describe, expect, it } from 'vitest'
import { temporalEventKindEnum, temporalTimePrecisionEnum } from '$lib/server/db/brain.schema'
import {
  applyCaptureAnchoredMentions,
  buildActivePeriodLiteral,
  parseTemporalMentions,
  resolveTemporalBounds,
  TEMPORAL_ELEMENT_CONTRACT,
  TEMPORAL_KIND_MEANINGS,
  TEMPORAL_PRECISION_MEANINGS,
} from './temporal-normalize'

const VALID = {
  surface: 'Friday at 9am',
  kind: 'appointment',
  startAt: '2026-10-30T09:00:00+01:00',
  timePrecision: 'exact',
  timezone: 'Europe/Berlin',
  isAllDay: false,
  confidence: 0.9,
  semanticSummary: 'Dentist appointment on Friday at 9am',
}

/** A reply array holding one element: VALID with `overrides` applied (a key set to undefined is removed). */
function reply(overrides: Record<string, unknown> = {}): string {
  const element: Record<string, unknown> = { ...VALID, ...overrides }
  for (const key of Object.keys(element)) if (element[key] === undefined) delete element[key]
  return JSON.stringify([element])
}

describe('parseTemporalMentions', () => {
  it('parses a mention with a clock time (timePrecision exact)', () => {
    const out = parseTemporalMentions(reply())
    expect(out).toEqual([
      {
        surface: 'Friday at 9am',
        kind: 'appointment',
        startAt: '2026-10-30T09:00:00+01:00',
        timePrecision: 'exact',
        timezone: 'Europe/Berlin',
        isAllDay: false,
        confidence: 0.9,
        semanticSummary: 'Dentist appointment on Friday at 9am',
      },
    ])
  })

  it('parses valid temporal mentions', () => {
    const out = parseTemporalMentions(
      `[
				{"surface":"due Friday","kind":"deadline","startAt":"2026-05-22T00:00:00.000Z","timePrecision":"day","timezone":"UTC","isAllDay":true,"confidence":0.9,"semanticSummary":"Report due Friday"}
			]`,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('deadline')
    expect(out[0]?.isAllDay).toBe(true)
  })

  it('throws when JSON is not an array', () => {
    expect(() => parseTemporalMentions('{}')).toThrow(/must be a JSON array/)
  })

  it('throws on timePrecision "hour" (the dentist reply), naming the field and the received value', () => {
    // The live reply for "Dentist appointment on Friday at 9am": right date, off-catalog precision.
    // It used to be dropped silently, so every capture with a clock time lost its date.
    expect(() => parseTemporalMentions(reply({ timePrecision: 'hour' }))).toThrow(
      /timePrecision.*"hour"/,
    )
  })

  it('names the element index and lists the allowed precisions', () => {
    const content = JSON.stringify([
      JSON.parse(reply())[0],
      JSON.parse(reply({ timePrecision: 'minute' }))[0],
    ])
    expect(() => parseTemporalMentions(content)).toThrow(
      /\[1\]\.timePrecision.*exact\|day\|week\|month\|fuzzy.*"minute"/,
    )
  })

  it('throws on an off-catalog kind, naming the field and the received value', () => {
    expect(() => parseTemporalMentions(reply({ kind: 'meeting' }))).toThrow(/kind.*"meeting"/)
  })

  it('does not echo the capture text in the error', () => {
    let message = ''
    try {
      parseTemporalMentions(reply({ timePrecision: 'hour' }))
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/timePrecision/)
    expect(message).not.toMatch(/Friday|Dentist/)
  })

  it.each(['surface', 'startAt', 'timePrecision', 'timezone', 'kind'])(
    'throws when %s is missing, naming the field',
    (field) => {
      expect(() => parseTemporalMentions(reply({ [field]: undefined }))).toThrow(
        new RegExp(`${field}.*missing`),
      )
    },
  )

  it.each(['surface', 'startAt', 'timePrecision', 'timezone'])(
    'throws when %s is blank or not a string, with the received value',
    (field) => {
      expect(() => parseTemporalMentions(reply({ [field]: '   ' }))).toThrow(
        new RegExp(`${field}.*"   "`),
      )
      expect(() => parseTemporalMentions(reply({ [field]: 7 }))).toThrow(
        new RegExp(`${field}.*received 7`),
      )
      expect(() => parseTemporalMentions(reply({ [field]: null }))).toThrow(
        new RegExp(`${field}.*received null`),
      )
    },
  )

  it('throws on an element that is not an object', () => {
    expect(() => parseTemporalMentions('[null]')).toThrow(/\[0\] must be an object.*null/)
    expect(() => parseTemporalMentions('["not-an-object"]')).toThrow(/\[0\] must be an object/)
    expect(() => parseTemporalMentions('[[1]]')).toThrow(/\[0\] must be an object/)
  })

  it('one bad element fails the whole parse (no partial result)', () => {
    const good = JSON.parse(reply())[0]
    const bad = JSON.parse(reply({ timePrecision: 'hour' }))[0]
    expect(() => parseTemporalMentions(JSON.stringify([good, bad]))).toThrow(/timePrecision/)
  })

  it('returns [] for an empty array (no temporal content is a valid answer)', () => {
    expect(parseTemporalMentions('[]')).toEqual([])
  })

  it.each([...temporalEventKindEnum])('accepts kind %s', (kind) => {
    expect(parseTemporalMentions(reply({ kind }))[0]?.kind).toBe(kind)
  })

  it.each([...temporalTimePrecisionEnum])('accepts timePrecision %s', (timePrecision) => {
    expect(parseTemporalMentions(reply({ timePrecision }))[0]?.timePrecision).toBe(timePrecision)
  })
})

describe('temporal element contract (shared by the bundle and the standalone prompt)', () => {
  it('has a meaning for exactly the kinds and precisions the schema allows', () => {
    expect(Object.keys(TEMPORAL_KIND_MEANINGS).sort()).toEqual([...temporalEventKindEnum].sort())
    expect(Object.keys(TEMPORAL_PRECISION_MEANINGS).sort()).toEqual(
      [...temporalTimePrecisionEnum].sort(),
    )
  })

  it('lists every allowed kind and precision with its meaning', () => {
    for (const [kind, meaning] of Object.entries(TEMPORAL_KIND_MEANINGS)) {
      expect(TEMPORAL_ELEMENT_CONTRACT).toContain(`${kind}: ${meaning}`)
    }
    for (const [precision, meaning] of Object.entries(TEMPORAL_PRECISION_MEANINGS)) {
      expect(TEMPORAL_ELEMENT_CONTRACT).toContain(`${precision}: ${meaning}`)
    }
  })

  it('says a clock time is "exact" and that other values invalidate the reply', () => {
    expect(TEMPORAL_PRECISION_MEANINGS.exact).toMatch(/clock time/)
    expect(TEMPORAL_ELEMENT_CONTRACT).toMatch(/"hour"/)
    expect(TEMPORAL_ELEMENT_CONTRACT).toMatch(/required/i)
  })

  it('names every required field', () => {
    for (const field of ['surface', 'kind', 'startAt', 'timePrecision', 'timezone']) {
      expect(TEMPORAL_ELEMENT_CONTRACT).toContain(field)
    }
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
  it('trims strings and clamps confidence', () => {
    const out = parseTemporalMentions(
      reply({
        surface: '  lunch  ',
        kind: ' appointment ',
        timePrecision: ' exact ',
        timezone: ' UTC ',
        confidence: 4,
        semanticSummary: '  Lunch meeting  ',
      }),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      surface: 'lunch',
      kind: 'appointment',
      timePrecision: 'exact',
      timezone: 'UTC',
      confidence: 1,
      semanticSummary: 'Lunch meeting',
    })
  })

  it('keeps optional fields optional and parses recurrenceRule', () => {
    const out = parseTemporalMentions(
      `[
				{
					"surface":"standup",
					"kind":"appointment",
					"startAt":"2026-06-01T09:00:00.000Z",
					"timePrecision":"exact",
					"timezone":"Europe/Berlin",
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
        timePrecision: 'exact',
        timezone: 'Europe/Berlin',
        isAllDay: false,
        recurrenceRule: 'FREQ=WEEKLY',
        confidence: 0,
        semanticSummary: 'standup',
      },
    ])
  })

  it('does not default timePrecision or timezone when the reply leaves them out', () => {
    // Both used to fall back silently ('fuzzy', 'UTC'): the stored date then looked right and was not.
    expect(() =>
      parseTemporalMentions(
        `[{"surface":"standup","kind":"appointment","startAt":"2026-06-01T09:00:00.000Z","timezone":"UTC"}]`,
      ),
    ).toThrow(/timePrecision/)
    expect(() =>
      parseTemporalMentions(
        `[{"surface":"standup","kind":"appointment","startAt":"2026-06-01T09:00:00.000Z","timePrecision":"exact"}]`,
      ),
    ).toThrow(/timezone/)
  })

  it('falls back semanticSummary to surface when summary is blank', () => {
    const out = parseTemporalMentions(reply({ semanticSummary: '   ' }))
    expect(out[0]?.semanticSummary).toBe('Friday at 9am')
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

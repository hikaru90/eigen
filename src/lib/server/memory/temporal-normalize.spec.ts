import { describe, expect, it } from 'vitest'
import { temporalEventKindEnum, temporalTimePrecisionEnum } from '$lib/server/db/brain.schema'
import {
  applyCaptureAnchoredMentions,
  buildActivePeriodLiteral,
  parseTemporalMentions,
  resolveTemporalBounds,
  TEMPORAL_ELEMENT_CONTRACT,
  TEMPORAL_ELEMENT_FIELDS,
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

  it.each(['surface', 'startAt', 'timePrecision', 'timezone', 'kind', 'semanticSummary'])(
    'throws when %s is missing, naming the field',
    (field) => {
      expect(() => parseTemporalMentions(reply({ [field]: undefined }))).toThrow(
        new RegExp(`${field}.*missing`),
      )
    },
  )

  it.each(['surface', 'startAt', 'timePrecision', 'timezone', 'semanticSummary'])(
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

  describe('semanticSummary is the event, required, with no fallback to the surface', () => {
    it('is kept as the model wrote it (trimmed)', () => {
      expect(
        parseTemporalMentions(
          reply({ semanticSummary: '  Call Mom about the birthday dinner ' }),
        )[0]?.semanticSummary,
      ).toBe('Call Mom about the birthday dinner')
    })

    it('a blank summary throws instead of becoming the surface', () => {
      expect(() => parseTemporalMentions(reply({ semanticSummary: '   ' }))).toThrow(
        /\[0\]\.semanticSummary.*" {3}"/,
      )
    })

    it('a missing summary throws, naming the field', () => {
      expect(() => parseTemporalMentions(reply({ semanticSummary: undefined }))).toThrow(
        /\[0\]\.semanticSummary.*missing/,
      )
    })
  })

  describe('recurrenceRule', () => {
    const yoga = { surface: 'every Tuesday at 7pm', semanticSummary: 'Yoga at Studio Nord' }

    it('keeps a rule the audit can read, trimmed', () => {
      expect(
        parseTemporalMentions(reply({ ...yoga, recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU' }))[0]
          ?.recurrenceRule,
      ).toBe('FREQ=WEEKLY;BYDAY=TU')
      expect(
        parseTemporalMentions(reply({ ...yoga, recurrenceRule: ' FREQ=DAILY ' }))[0]
          ?.recurrenceRule,
      ).toBe('FREQ=DAILY')
      expect(
        parseTemporalMentions(reply({ ...yoga, recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=1' }))[0]
          ?.recurrenceRule,
      ).toBe('FREQ=MONTHLY;BYMONTHDAY=1')
    })

    it.each([undefined, null, '', '   '])('is omitted when the reply gives %j', (value) => {
      const out = parseTemporalMentions(reply({ ...yoga, recurrenceRule: value }))
      expect(out[0]).not.toHaveProperty('recurrenceRule')
    })

    it.each([
      ['a frequency the audit cannot express', 'FREQ=HOURLY'],
      ['a part the audit cannot express', 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1'],
      ['several month days', 'FREQ=MONTHLY;BYMONTHDAY=1,15'],
      ['COUNT together with UNTIL', 'FREQ=DAILY;COUNT=3;UNTIL=20261231'],
      ['an impossible UNTIL', 'FREQ=DAILY;UNTIL=20261340'],
      ['prose', 'every Tuesday'],
      ['a rule without FREQ', 'BYDAY=TU'],
    ])('throws on %s, naming the field and the received value', (_label, rule) => {
      const content = reply({ ...yoga, recurrenceRule: rule })
      expect(() => parseTemporalMentions(content)).toThrow(/\[0\]\.recurrenceRule/)
      expect(() => parseTemporalMentions(content)).toThrow(JSON.stringify(rule))
    })

    it('throws on a rule that is not a string', () => {
      expect(() => parseTemporalMentions(reply({ ...yoga, recurrenceRule: 7 }))).toThrow(
        /\[0\]\.recurrenceRule.*received 7/,
      )
      expect(() =>
        parseTemporalMentions(reply({ ...yoga, recurrenceRule: ['FREQ=DAILY'] })),
      ).toThrow(/\[0\]\.recurrenceRule/)
    })

    it('names the element index of the bad rule', () => {
      const content = JSON.stringify([
        JSON.parse(reply())[0],
        JSON.parse(reply({ ...yoga, recurrenceRule: 'FREQ=HOURLY' }))[0],
      ])
      expect(() => parseTemporalMentions(content)).toThrow(/\[1\]\.recurrenceRule/)
    })
  })

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
    for (const field of [
      'surface',
      'kind',
      'startAt',
      'timePrecision',
      'timezone',
      'semanticSummary',
    ]) {
      expect(TEMPORAL_ELEMENT_CONTRACT).toContain(`- ${field} (required)`)
    }
  })

  it('describes every field the parser can return, and nothing else', () => {
    // A fully populated element: the parser's output keys are the fields the contract must list.
    const full = parseTemporalMentions(
      JSON.stringify([
        {
          ...VALID,
          endAt: '2026-10-30T10:00:00+01:00',
          recurrenceRule: 'FREQ=WEEKLY',
          durationMinutes: 30,
          energyLevel: 'light',
          priorityQuadrant: 'neither',
          contextTags: ['@home'],
          parentSurface: 'the trip',
          relativeSpec: { dateAnchor: 'capture_time', relativeDaysPast: 1 },
        },
      ]),
    )[0]
    expect(Object.keys(TEMPORAL_ELEMENT_FIELDS).sort()).toEqual(Object.keys(full ?? {}).sort())
    for (const field of Object.keys(TEMPORAL_ELEMENT_FIELDS)) {
      expect(TEMPORAL_ELEMENT_CONTRACT).toContain(`- ${field} (`)
    }
  })

  // Pinned word for word: the operator's wording after the live smoke showed the model writing the
  // time instead of the event, and never repeating an event.
  it('semanticSummary is the event, never just the time', () => {
    expect(TEMPORAL_ELEMENT_FIELDS.semanticSummary).toEqual({
      need: 'required',
      description: `what happens or is due — the event itself in the user's words ("Call Mom about the birthday dinner", "Yoga at Studio Nord"), never just the time (not "Friday", not "the week starting 2 November").`,
    })
    expect(TEMPORAL_ELEMENT_CONTRACT).toContain(
      `- semanticSummary (required): what happens or is due — the event itself in the user's words ("Call Mom about the birthday dinner", "Yoga at Studio Nord"), never just the time (not "Friday", not "the week starting 2 November").`,
    )
  })

  it('recurrenceRule is required when the capture says the event repeats, omitted otherwise', () => {
    expect(TEMPORAL_ELEMENT_FIELDS.recurrenceRule).toEqual({
      need: 'when_repeating',
      description:
        'an iCal RRULE: "every Tuesday at 7pm" → FREQ=WEEKLY;BYDAY=TU with startAt the first occurrence at that time; "every day" → FREQ=DAILY; "every month on the 1st" → FREQ=MONTHLY;BYMONTHDAY=1.',
    })
    expect(TEMPORAL_ELEMENT_CONTRACT).toContain(
      '- recurrenceRule (required when the capture says the event repeats, omitted otherwise): an iCal RRULE: "every Tuesday at 7pm" → FREQ=WEEKLY;BYDAY=TU with startAt the first occurrence at that time; "every day" → FREQ=DAILY; "every month on the 1st" → FREQ=MONTHLY;BYMONTHDAY=1.',
    )
  })

  it('says which rules the audit can read, and that an unreadable one invalidates the reply', () => {
    expect(TEMPORAL_ELEMENT_CONTRACT).toContain(
      'FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, COUNT, UNTIL',
    )
    expect(TEMPORAL_ELEMENT_CONTRACT).toMatch(/recurrenceRule.*invalid/s)
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
					"confidence":"not-a-number",
					"semanticSummary":"Standup"
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
        semanticSummary: 'Standup',
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

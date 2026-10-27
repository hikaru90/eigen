import { describe, expect, it } from 'vitest'
import {
  assertRecurrenceRuleReadable,
  describeRecurrence,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_RULE_PARTS,
} from './recurrence'

// Tuesday 3 November 2026, 19:00 in Berlin (CET, UTC+1).
const TUESDAY_EVENING = new Date('2026-11-03T18:00:00.000Z')
const BERLIN = 'Europe/Berlin'

const describe_ = (rule: string, start: Date = TUESDAY_EVENING, timezone: string = BERLIN) =>
  describeRecurrence({ rule, start, timeZone: timezone })

describe('describeRecurrence: the RRULE subset the app expands (DAILY, WEEKLY, MONTHLY)', () => {
  it('weekly without BYDAY repeats on the weekday of the start, in the event time zone', () => {
    expect(describe_('FREQ=WEEKLY')).toEqual({ cadence: 'every Tuesday', limit: null })
  })

  it('takes the weekday from the event time zone, not from UTC', () => {
    // 22:30 UTC on Tuesday is already Wednesday 11:30 in Auckland.
    expect(
      describe_('FREQ=WEEKLY', new Date('2026-11-03T22:30:00.000Z'), 'Pacific/Auckland'),
    ).toEqual({
      cadence: 'every Wednesday',
      limit: null,
    })
  })

  it('accepts an RRULE: prefix, lower case and surrounding spaces', () => {
    expect(describe_('RRULE:FREQ=WEEKLY').cadence).toBe('every Tuesday')
    expect(describe_(' freq=weekly ').cadence).toBe('every Tuesday')
  })

  it('lists BYDAY weekdays for a weekly rule', () => {
    expect(describe_('FREQ=WEEKLY;BYDAY=TU').cadence).toBe('every Tuesday')
    expect(describe_('FREQ=WEEKLY;BYDAY=MO,WE').cadence).toBe('every Monday and Wednesday')
    expect(describe_('FREQ=WEEKLY;BYDAY=MO,WE,FR').cadence).toBe(
      'every Monday, Wednesday and Friday',
    )
  })

  it('names the interval of a weekly rule', () => {
    expect(describe_('FREQ=WEEKLY;INTERVAL=2').cadence).toBe('every 2 weeks on Tuesday')
    expect(describe_('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE').cadence).toBe(
      'every 2 weeks on Monday and Wednesday',
    )
    expect(describe_('FREQ=WEEKLY;INTERVAL=1').cadence).toBe('every Tuesday')
  })

  it('describes a daily rule, with an interval, and the weekday forms', () => {
    expect(describe_('FREQ=DAILY').cadence).toBe('every day')
    expect(describe_('FREQ=DAILY;INTERVAL=3').cadence).toBe('every 3 days')
    expect(describe_('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR').cadence).toBe('every weekday')
    expect(describe_('FREQ=DAILY;BYDAY=SA,SU').cadence).toBe('every Saturday and Sunday')
  })

  it('takes a monthly rule on the day of month of the start unless BYMONTHDAY says otherwise', () => {
    expect(describe_('FREQ=MONTHLY').cadence).toBe('every month on the 3rd')
    expect(describe_('FREQ=MONTHLY;INTERVAL=2').cadence).toBe('every 2 months on the 3rd')
    expect(describe_('FREQ=MONTHLY;BYMONTHDAY=15').cadence).toBe('every month on the 15th')
    expect(describe_('FREQ=MONTHLY;BYMONTHDAY=-1').cadence).toBe('every month on the last day')
    expect(describe_('FREQ=MONTHLY;BYMONTHDAY=21').cadence).toBe('every month on the 21st')
    expect(describe_('FREQ=MONTHLY;BYMONTHDAY=12').cadence).toBe('every month on the 12th')
  })

  it('describes a monthly rule on the nth weekday', () => {
    expect(describe_('FREQ=MONTHLY;BYDAY=2TU').cadence).toBe('every month on the second Tuesday')
    expect(describe_('FREQ=MONTHLY;BYDAY=-1FR').cadence).toBe('every month on the last Friday')
    expect(describe_('FREQ=MONTHLY;BYDAY=1MO;INTERVAL=3').cadence).toBe(
      'every 3 months on the first Monday',
    )
  })

  it('describes a yearly rule on the date of the start or on BYMONTH and BYMONTHDAY', () => {
    expect(describe_('FREQ=YEARLY').cadence).toBe('every year on 3 November')
    expect(describe_('FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14').cadence).toBe('every year on 14 March')
    expect(describe_('FREQ=YEARLY;INTERVAL=2').cadence).toBe('every 2 years on 3 November')
  })
})

describe('describeRecurrence: how long it repeats', () => {
  it('turns COUNT into a limit', () => {
    expect(describe_('FREQ=WEEKLY;COUNT=4').limit).toBe('for 4 occurrences')
    expect(describe_('FREQ=DAILY;COUNT=1').limit).toBe('for 1 occurrence')
  })

  it('turns a date UNTIL into the last day', () => {
    expect(describe_('FREQ=WEEKLY;UNTIL=20261231').limit).toBe('until Thursday 31 December 2026')
  })

  it('converts a UTC UNTIL to the day it falls on in the event time zone', () => {
    // 22:59:59 UTC is 23:59:59 in Berlin (still the 31st); one second later is the 1st.
    expect(describe_('FREQ=WEEKLY;UNTIL=20261231T225959Z').limit).toBe(
      'until Thursday 31 December 2026',
    )
    expect(describe_('FREQ=WEEKLY;UNTIL=20261231T230000Z').limit).toBe(
      'until Friday 1 January 2027',
    )
  })

  it('takes a floating UNTIL date-time at its own date', () => {
    expect(describe_('FREQ=WEEKLY;UNTIL=20261231T120000').limit).toBe(
      'until Thursday 31 December 2026',
    )
  })

  it('has no limit by default', () => {
    expect(describe_('FREQ=WEEKLY').limit).toBeNull()
  })
})

describe('describeRecurrence: fails loudly on anything it cannot express', () => {
  const unsupported: Array<[string, string, RegExp]> = [
    ['an empty rule', '', /empty/],
    ['a rule without FREQ', 'INTERVAL=2', /FREQ/],
    ['an unknown frequency', 'FREQ=HOURLY', /FREQ/],
    ['a frequency not in the subset', 'FREQ=MINUTELY', /FREQ/],
    ['BYSETPOS', 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1', /BYSETPOS/],
    ['WKST', 'FREQ=WEEKLY;WKST=MO', /WKST/],
    ['BYHOUR', 'FREQ=DAILY;BYHOUR=9', /BYHOUR/],
    ['BYMONTHDAY on a weekly rule', 'FREQ=WEEKLY;BYMONTHDAY=3', /BYMONTHDAY/],
    ['BYMONTH on a monthly rule', 'FREQ=MONTHLY;BYMONTH=3', /BYMONTH/],
    ['BYDAY on a yearly rule', 'FREQ=YEARLY;BYDAY=MO', /BYDAY/],
    ['a zero interval', 'FREQ=DAILY;INTERVAL=0', /INTERVAL/],
    ['a non-numeric interval', 'FREQ=DAILY;INTERVAL=x', /INTERVAL/],
    ['a negative interval', 'FREQ=DAILY;INTERVAL=-2', /INTERVAL/],
    ['a zero count', 'FREQ=DAILY;COUNT=0', /COUNT/],
    ['a non-numeric count', 'FREQ=DAILY;COUNT=many', /COUNT/],
    ['COUNT together with UNTIL', 'FREQ=DAILY;COUNT=3;UNTIL=20261231', /COUNT.*UNTIL/],
    ['an unparseable UNTIL', 'FREQ=DAILY;UNTIL=soon', /UNTIL/],
    ['an impossible UNTIL date', 'FREQ=DAILY;UNTIL=20261340', /UNTIL/],
    ['an unknown weekday code', 'FREQ=WEEKLY;BYDAY=XX', /BYDAY/],
    ['an ordinal weekday on a weekly rule', 'FREQ=WEEKLY;BYDAY=2TU', /BYDAY/],
    ['a plain weekday on a monthly rule', 'FREQ=MONTHLY;BYDAY=TU', /BYDAY/],
    ['several ordinal weekdays on a monthly rule', 'FREQ=MONTHLY;BYDAY=1MO,3MO', /BYDAY/],
    ['an ordinal outside first..fourth and last', 'FREQ=MONTHLY;BYDAY=5MO', /BYDAY/],
    ['several month days', 'FREQ=MONTHLY;BYMONTHDAY=1,15', /BYMONTHDAY/],
    ['a month day out of range', 'FREQ=MONTHLY;BYMONTHDAY=32', /BYMONTHDAY/],
    [
      'BYDAY together with BYMONTHDAY on a monthly rule',
      'FREQ=MONTHLY;BYDAY=1MO;BYMONTHDAY=3',
      /BYDAY.*BYMONTHDAY/,
    ],
    [
      'an interval together with a daily weekday filter',
      'FREQ=DAILY;INTERVAL=2;BYDAY=MO',
      /INTERVAL/,
    ],
    ['a repeated key', 'FREQ=DAILY;FREQ=WEEKLY', /twice/],
    ['an empty segment', 'FREQ=DAILY;', /segment/],
    ['a segment without a value', 'FREQ=DAILY;COUNT', /segment/],
    ['a month number out of range', 'FREQ=YEARLY;BYMONTH=13;BYMONTHDAY=1', /BYMONTH/],
  ]

  it.each(unsupported)('rejects %s', (_label, rule, pattern) => {
    expect(() => describe_(rule)).toThrow(pattern)
  })

  it.each(unsupported)(
    'assertRecurrenceRuleReadable rejects %s, with the same reason',
    (_label, rule, pattern) => {
      expect(() => assertRecurrenceRuleReadable(rule)).toThrow(pattern)
    },
  )

  it('marks the error as a capture-review error and never repeats the whole rule', () => {
    try {
      describe_('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1')
      expect.unreachable()
    } catch (err) {
      expect(String(err)).toContain('[capture-review]')
      expect(String(err)).not.toContain('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1')
    }
  })

  it('rejects a time zone it does not know', () => {
    expect(() => describe_('FREQ=WEEKLY', TUESDAY_EVENING, 'Mars/Olympus')).toThrow(/time zone/)
  })
})

describe('assertRecurrenceRuleReadable', () => {
  it.each([
    'FREQ=WEEKLY;BYDAY=TU',
    'FREQ=DAILY',
    'FREQ=MONTHLY;BYMONTHDAY=1',
    'FREQ=MONTHLY;BYDAY=2TU;INTERVAL=3',
    'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14',
    'FREQ=WEEKLY;COUNT=4',
    'FREQ=WEEKLY;UNTIL=20261231',
    'FREQ=WEEKLY;UNTIL=20261231T225959Z',
    'RRULE:FREQ=WEEKLY',
    ' freq=weekly ',
  ])('accepts %s, a rule describeRecurrence can express', (rule) => {
    expect(() => assertRecurrenceRuleReadable(rule)).not.toThrow()
    expect(() => describe_(rule)).not.toThrow()
  })

  it('needs no start and no time zone', () => {
    expect(() => assertRecurrenceRuleReadable('FREQ=WEEKLY')).not.toThrow()
  })

  it('names what the audit can read, so a prompt can say it', () => {
    expect([...RECURRENCE_FREQUENCIES]).toEqual(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
    expect([...RECURRENCE_RULE_PARTS]).toEqual([
      'INTERVAL',
      'BYDAY',
      'BYMONTHDAY',
      'BYMONTH',
      'COUNT',
      'UNTIL',
    ])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compactTemporalFieldsForMcp,
  enhanceSnippetWithTemporalContext,
  loadTemporalContextByThoughtIds,
} from './temporal-context'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

function mockTemporalRows(
  rows: Array<{
    thoughtId: string
    kind: string
    semanticSummary: string
    activePeriod: string
  }>,
) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => Promise.resolve(rows),
  }
  getDbMock.mockReturnValue(chain)
}

describe('loadTemporalContextByThoughtIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an empty map when no thought ids are requested', async () => {
    const map = await loadTemporalContextByThoughtIds({
      userId: 'u1',
      thoughtIds: [],
      now: new Date('2026-06-05T12:00:00.000Z'),
    })
    expect(map.size).toBe(0)
    expect(getDbMock).not.toHaveBeenCalled()
  })

  it('classifies active and expired events per thought', async () => {
    mockTemporalRows([
      {
        thoughtId: 't-active',
        kind: 'reminder',
        semanticSummary: 'ship release',
        activePeriod: '[2026-06-05T10:00:00.000Z,2026-06-06T10:00:00.000Z)',
      },
      {
        thoughtId: 't-expired',
        kind: 'reminder',
        semanticSummary: 'separate eigenmesh app',
        activePeriod: '[2026-06-02T12:00:00.000Z,2026-06-02T18:00:00.000Z)',
      },
    ])
    const now = new Date('2026-06-05T12:00:00.000Z')
    const map = await loadTemporalContextByThoughtIds({
      userId: 'u1',
      thoughtIds: ['t-active', 't-expired', 't-none'],
      now,
    })
    expect(map.get('t-active')?.temporalStatus).toBe('active')
    expect(map.get('t-expired')?.temporalStatus).toBe('expired')
    expect(map.get('t-none')?.temporalStatus).toBe('none')
  })
})

describe('compactTemporalFieldsForMcp', () => {
  it('returns none when no temporal context exists', () => {
    expect(compactTemporalFieldsForMcp(undefined, new Date('2026-06-05T12:00:00.000Z'))).toEqual({
      temporalStatus: 'none',
      temporalSummary: undefined,
    })
  })

  it('returns none when context explicitly has status none', () => {
    expect(
      compactTemporalFieldsForMcp(
        {
          temporalStatus: 'none',
          temporalEvents: [
            {
              kind: 'reminder',
              semanticSummary: 'ignored',
              activePeriod: '[2026-06-02T12:00:00.000Z,2026-06-02T18:00:00.000Z)',
              expired: true,
            },
          ],
        },
        new Date('2026-06-05T12:00:00.000Z'),
      ),
    ).toEqual({ temporalStatus: 'none', temporalSummary: undefined })
  })

  it('returns expired summary for past events', () => {
    const now = new Date('2026-06-05T12:00:00.000Z')
    const { temporalStatus, temporalSummary } = compactTemporalFieldsForMcp(
      {
        temporalStatus: 'expired',
        temporalEvents: [
          {
            kind: 'reminder',
            semanticSummary: 'separate eigenmesh app',
            activePeriod: '[2026-06-02T12:00:00.000Z,2026-06-02T18:00:00.000Z)',
            expired: true,
          },
        ],
      },
      now,
    )
    expect(temporalStatus).toBe('expired')
    expect(temporalSummary).toContain('EXPIRED')
    expect(temporalSummary).toContain('separate eigenmesh app')
  })

  it('returns active summary for ongoing events', () => {
    const now = new Date('2026-06-05T12:00:00.000Z')
    const { temporalStatus, temporalSummary } = compactTemporalFieldsForMcp(
      {
        temporalStatus: 'active',
        temporalEvents: [
          {
            kind: 'reminder',
            semanticSummary: 'ship release',
            activePeriod: '[2026-06-05T10:00:00.000Z,2026-06-06T10:00:00.000Z)',
            expired: false,
          },
        ],
      },
      now,
    )
    expect(temporalStatus).toBe('active')
    expect(temporalSummary).toContain('ACTIVE')
    expect(temporalSummary).toContain('ship release')
  })

  it('returns none summary when context status is none', () => {
    expect(
      compactTemporalFieldsForMcp(
        { temporalStatus: 'none', temporalEvents: [] },
        new Date('2026-06-05T12:00:00.000Z'),
      ),
    ).toEqual({ temporalStatus: 'none', temporalSummary: undefined })
  })

  it('returns undefined summary when active context has no events to annotate', () => {
    expect(
      compactTemporalFieldsForMcp(
        { temporalStatus: 'active', temporalEvents: [] },
        new Date('2026-06-05T12:00:00.000Z'),
      ),
    ).toEqual({ temporalStatus: 'active', temporalSummary: undefined })
  })

  it('omits summary when annotation strips to empty text', () => {
    const result = compactTemporalFieldsForMcp(
      {
        temporalStatus: 'active',
        temporalEvents: [
          {
            kind: 'reminder',
            semanticSummary: '   ',
            activePeriod: '[2026-06-05T10:00:00.000Z,2026-06-06T10:00:00.000Z)',
            expired: false,
          },
        ],
      },
      new Date('2026-06-05T12:00:00.000Z'),
    )
    expect(result.temporalStatus).toBe('active')
    expect(result.temporalSummary).toContain('reminder')
  })
})

describe('enhanceSnippetWithTemporalContext', () => {
  it('appends stored date and temporal summary to snippet', () => {
    const out = enhanceSnippetWithTemporalContext({
      snippet: 'ich würde heute nachmittag gerne die app trennen',
      storedAt: new Date('2026-06-02T10:00:00.000Z'),
      temporalStatus: 'expired',
      temporalSummary: '"separate app" (Jun 2, 2026) — EXPIRED',
    })
    expect(out).toContain('ich würde heute nachmittag')
    expect(out).toContain('stored 2026-06-02')
    expect(out).toContain('EXPIRED')
  })

  it('notes missing event date when temporal status is none', () => {
    const out = enhanceSnippetWithTemporalContext({
      snippet: 'plain thought',
      storedAt: new Date('2026-06-02T10:00:00.000Z'),
      temporalStatus: 'none',
      temporalSummary: undefined,
    })
    expect(out).toBe('plain thought (stored 2026-06-02; no linked event date)')
  })

  it('does not double-append when snippet already ends with stored date suffix', () => {
    const out = enhanceSnippetWithTemporalContext({
      snippet: 'meeting notes (2026-06-02)',
      storedAt: new Date('2026-06-02T10:00:00.000Z'),
      temporalStatus: 'none',
      temporalSummary: undefined,
    })
    expect(out).toBe('meeting notes (2026-06-02)')
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildMemoryExportZip, EXPORT_VERSION } from './memory-export'
import { THOUGHTS_CSV_HEADERS } from './thoughts-csv'

const { getDbMock, buildGraphExportJsonMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  buildGraphExportJsonMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('./graph-export', () => ({
  buildGraphExportJson: buildGraphExportJsonMock,
}))

function makeSelectChain(rows: unknown[]) {
  const orderBy = vi.fn(async () => rows)
  const where = vi.fn(() => ({ orderBy }))
  const from = vi.fn(() => ({ where }))
  return { from }
}

beforeEach(() => {
  getDbMock.mockReset()
  buildGraphExportJsonMock.mockReset()
})

describe('buildMemoryExportZip', () => {
  it('produces a ZIP with manifest and expected CSV headers', async () => {
    const createdAt = new Date('2026-05-26T10:00:00.000Z')
    const updatedAt = new Date('2026-05-26T11:00:00.000Z')

    const selectResults: unknown[][] = [
      [
        {
          id: 't1',
          createdAt,
          updatedAt,
          category: 'task',
          rawText: 'Hello',
          rawTextEncrypted: null,
          normalizedText: 'Hello',
          normalizedTextEncrypted: null,
          metadata: { status: 'open' },
          metadataEncrypted: null,
        },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    ]

    let call = 0
    getDbMock.mockReturnValue({
      select: vi.fn(() => makeSelectChain(selectResults[call++] ?? [])),
    })

    buildGraphExportJsonMock.mockResolvedValue({
      userId: 'u1',
      thoughts: [{ id: 't1', category: 'task' }],
      entities: [],
      events: [],
      relates_to: [],
      mentions: [],
      entity_relates: [],
      occurs_in: [],
      involves: [],
      counts: {
        thoughts: 1,
        entities: 0,
        events: 0,
        relates_to: 0,
        mentions: 0,
        entity_relates: 0,
        occurs_in: 0,
        involves: 0,
      },
    })

    const result = await buildMemoryExportZip('u1')

    expect(result.filename).toMatch(/^eigen-memory-export-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(result.manifest.exportVersion).toBe(EXPORT_VERSION)
    expect(result.manifest.userId).toBe('u1')
    expect(result.manifest.files['thoughts.csv']).toBe(1)

    const files = unzipSync(result.bytes)
    const fileNames = Object.keys(files).sort()
    expect(fileNames).toEqual([
      'entities.csv',
      'entity_aliases.csv',
      'graph.json',
      'manifest.json',
      'temporal_events.csv',
      'text_files.csv',
      'thought_entities.csv',
      'thought_relations.csv',
      'thought_text_file.csv',
      'thoughts.csv',
    ])

    const thoughtsCsv = strFromU8(files['thoughts.csv'])
    expect(thoughtsCsv.split('\n')[0]).toBe(THOUGHTS_CSV_HEADERS.join(','))

    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.userId).toBe('u1')
    expect(manifest.files['thoughts.csv']).toBe(1)

    const graphJson = JSON.parse(strFromU8(files['graph.json']))
    expect(graphJson.userId).toBe('u1')
    expect(graphJson.thoughts).toHaveLength(1)
    expect(JSON.stringify(graphJson)).not.toContain('embedding')
  })
})

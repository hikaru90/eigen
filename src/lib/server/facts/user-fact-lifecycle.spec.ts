import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ state: { db: null as unknown } }))
vi.mock('$lib/server/db', () => ({ getDb: () => m.state.db }))

import { userFact, userFactSource, userSecureValue } from '$lib/server/db/schema'
import { createRecordingDb, type RecordedEvent } from '$lib/test/recording-db'
import {
  forgetUserFacts,
  releaseThoughtFacts,
  retireFactsForArchivedNote,
  retireFactsForArchivedThought,
  retireFactsWithoutLiveSource,
  sourceIsLive,
} from './user-fact-lifecycle'

const THOUGHT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FILE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const factRow = (
  id: string,
  over: Partial<{ status: string; secureValueId: string | null; supersededBy: string | null }> = {},
) => ({ id, status: 'active', secureValueId: null, supersededBy: null, ...over })

const thoughtSource = (factId: string, lifecycle: string | null = 'open') => ({
  factId,
  thoughtId: THOUGHT,
  textFileId: null,
  thoughtLifecycle: lifecycle,
  fileId: null,
  fileArchivedAt: null,
})
const noteSource = (factId: string, archivedAt: Date | null = null, exists = true) => ({
  factId,
  thoughtId: null,
  textFileId: FILE,
  thoughtLifecycle: null,
  fileId: exists ? FILE : null,
  fileArchivedAt: archivedAt,
})

const updates = (events: RecordedEvent[], table: unknown = userFact) =>
  events.filter((e) => e.kind === 'update' && e.table === table)
const deletes = (events: RecordedEvent[], table: unknown) =>
  events.filter((e) => e.kind === 'delete' && e.table === table)

beforeEach(() => vi.clearAllMocks())

describe('sourceIsLive', () => {
  it('a thought source lives while the thought is not archived (completed still counts)', () => {
    expect(sourceIsLive(thoughtSource('f', 'open'))).toBe(true)
    expect(sourceIsLive(thoughtSource('f', 'completed'))).toBe(true)
    expect(sourceIsLive(thoughtSource('f', 'archived'))).toBe(false)
    expect(sourceIsLive(thoughtSource('f', null))).toBe(false)
  })

  it('a note source lives while the note exists and is not archived', () => {
    expect(sourceIsLive(noteSource('f'))).toBe(true)
    expect(sourceIsLive(noteSource('f', new Date()))).toBe(false)
    expect(sourceIsLive(noteSource('f', null, false))).toBe(false)
  })

  it('a fact derived from a thought AND its note lives while either does', () => {
    const both = {
      factId: 'f',
      thoughtId: THOUGHT,
      textFileId: FILE,
      thoughtLifecycle: 'archived',
      fileId: FILE,
      fileArchivedAt: null,
    }
    expect(sourceIsLive(both)).toBe(true)
    expect(sourceIsLive({ ...both, fileArchivedAt: new Date() })).toBe(false)
  })
})

describe('retireFactsWithoutLiveSource', () => {
  it('forgets a fact whose only source is archived and deletes its secure value', async () => {
    const rec = createRecordingDb([
      [factRow('a', { secureValueId: 'sv1' }), factRow('b')],
      [thoughtSource('a', 'archived'), thoughtSource('b', 'open')],
      [],
    ])
    m.state.db = rec.db
    const out = await retireFactsWithoutLiveSource('u1', ['a', 'b'], { revive: true })
    expect(out).toEqual({ retired: ['a'], revived: [] })
    expect(updates(rec.events)).toHaveLength(1)
    expect(updates(rec.events)[0]).toMatchObject({ set: { status: 'forgotten' } })
    expect(deletes(rec.events, userSecureValue)).toHaveLength(1)
  })

  it('does nothing and deletes nothing when every fact still has a live source', async () => {
    const rec = createRecordingDb([[factRow('a')], [thoughtSource('a', 'open')], []])
    m.state.db = rec.db
    const out = await retireFactsWithoutLiveSource('u1', ['a'], { revive: true })
    expect(out).toEqual({ retired: [], revived: [] })
    expect(rec.events.some((e) => e.kind === 'update' || e.kind === 'delete')).toBe(false)
  })

  it('a note that was archived does not keep a fact alive; a live note does', async () => {
    const rec = createRecordingDb([
      [factRow('gone'), factRow('kept')],
      [noteSource('gone', new Date()), noteSource('kept')],
      [],
    ])
    m.state.db = rec.db
    const out = await retireFactsWithoutLiveSource('u1', ['gone', 'kept'], { revive: false })
    expect(out.retired).toEqual(['gone'])
  })

  it('reopens the fact the retired one had replaced (source loss), with its replacement cleared', async () => {
    const rec = createRecordingDb([
      [factRow('N')],
      [thoughtSource('N', 'archived')],
      [factRow('X', { status: 'superseded', supersededBy: 'N' })],
    ])
    m.state.db = rec.db
    const out = await retireFactsWithoutLiveSource('u1', ['N'], { revive: true })
    expect(out).toEqual({ retired: ['N'], revived: ['X'] })
    const reopen = updates(rec.events).find((e) => e.kind === 'update' && e.set.status === 'active')
    expect(reopen).toMatchObject({ set: { status: 'active', supersededBy: null } })
  })

  it('never reopens anything when told not to (a forget request)', async () => {
    const rec = createRecordingDb([[factRow('N')], [thoughtSource('N', 'archived')]])
    m.state.db = rec.db
    const out = await retireFactsWithoutLiveSource('u1', ['N'], { revive: false })
    expect(out.revived).toEqual([])
    expect(updates(rec.events).every((e) => e.kind === 'update' && e.set.status !== 'active')).toBe(
      true,
    )
  })

  it('no ids, no queries', async () => {
    const rec = createRecordingDb()
    m.state.db = rec.db
    expect(await retireFactsWithoutLiveSource('u1', [], { revive: true })).toEqual({
      retired: [],
      revived: [],
    })
    expect(rec.events).toEqual([])
  })
})

describe('source hooks', () => {
  it('archiving a thought retires the facts only it carried; its source links stay (the audit trail)', async () => {
    const rec = createRecordingDb([
      [{ factId: 'a' }, { factId: 'b' }],
      [factRow('a'), factRow('b')],
      [thoughtSource('a', 'archived'), thoughtSource('b', 'archived'), noteSource('b')],
      [],
    ])
    m.state.db = rec.db
    const out = await retireFactsForArchivedThought('u1', THOUGHT)
    // b is also derived from a live note: it stays
    expect(out.retired).toEqual(['a'])
    expect(deletes(rec.events, userFactSource)).toEqual([])
  })

  it('archiving a note does the same for the facts derived from it', async () => {
    const rec = createRecordingDb([
      [{ factId: 'a' }],
      [factRow('a')],
      [noteSource('a', new Date())],
      [],
    ])
    m.state.db = rec.db
    const out = await retireFactsForArchivedNote('u1', FILE)
    expect(out.retired).toEqual(['a'])
  })

  it('a thought with no facts costs one query', async () => {
    const rec = createRecordingDb([[]])
    m.state.db = rec.db
    expect(await retireFactsForArchivedThought('u1', THOUGHT)).toEqual({ retired: [], revived: [] })
    expect(rec.events).toHaveLength(1)
  })
})

describe('releaseThoughtFacts (re-derive: enrichment retry, edit)', () => {
  it('drops this thought as a source, retires facts nothing else carries, keeps the rest', async () => {
    const rec = createRecordingDb([
      [{ factId: 'a' }, { factId: 'b' }],
      [factRow('a'), factRow('b')],
      // after the link rows are deleted only b still has a source: a live note
      [noteSource('b')],
      [],
    ])
    m.state.db = rec.db
    await releaseThoughtFacts('u1', THOUGHT)
    expect(deletes(rec.events, userFactSource)).toHaveLength(1)
    const deleteAt = rec.events.findIndex((e) => e.kind === 'delete' && e.table === userFactSource)
    const forgetAt = rec.events.findIndex(
      (e) => e.kind === 'update' && e.table === userFact && e.set.status === 'forgotten',
    )
    expect(deleteAt).toBeGreaterThanOrEqual(0)
    expect(forgetAt).toBeGreaterThan(deleteAt)
  })

  it('does nothing when the thought derived nothing', async () => {
    const rec = createRecordingDb([[]])
    m.state.db = rec.db
    await releaseThoughtFacts('u1', THOUGHT)
    expect(rec.events.some((e) => e.kind === 'delete' || e.kind === 'update')).toBe(false)
  })
})

describe('forgetUserFacts (a forget request)', () => {
  it('marks the facts forgotten, deletes their secure values and reports which changed', async () => {
    const rec = createRecordingDb([[factRow('a', { secureValueId: 'sv1' }), factRow('b')]])
    m.state.db = rec.db
    const changed = await forgetUserFacts('u1', ['a', 'b', 'already'])
    expect(changed).toEqual(['a', 'b'])
    expect(updates(rec.events)[0]).toMatchObject({ set: { status: 'forgotten' } })
    expect(deletes(rec.events, userSecureValue)).toHaveLength(1)
  })

  it('nothing to forget -> nothing written', async () => {
    const rec = createRecordingDb([[]])
    m.state.db = rec.db
    expect(await forgetUserFacts('u1', ['x'])).toEqual([])
    expect(rec.events.some((e) => e.kind === 'update' || e.kind === 'delete')).toBe(false)
  })
})

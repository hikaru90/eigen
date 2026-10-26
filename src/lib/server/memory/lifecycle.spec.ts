import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLifecycleTarget, setThoughtLifecycleStatus } from './lifecycle'

const THOUGHT_ID = '11111111-2222-4333-8444-555555555555'
const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const mocks = vi.hoisted(() => ({
  updateCalls: [] as unknown[],
  getDb: vi.fn(),
  retireFacts: vi.fn(),
}))

vi.mock('$lib/server/facts/user-fact-lifecycle', () => ({
  retireFactsForArchivedThought: mocks.retireFacts,
}))

vi.mock('$lib/server/db', () => ({
  getDb: mocks.getDb,
}))

vi.mock('$lib/server/ontology-db', () => ({
  ensureUserOntologySeeded: vi.fn(),
}))

vi.mock('$lib/server/capture/capture-result', () => ({
  loadThoughtCaptureResult: vi.fn(async () => ({ id: THOUGHT_ID, category: 'task' })),
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: vi.fn(async () => '{}'),
  encryptTenantValue: vi.fn(async () => 'enc'),
}))

vi.mock('$lib/server/graph/age', () => ({
  removeThoughtGraphArtifacts: vi.fn(),
  upsertThoughtNode: vi.fn(),
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  clearNextActionIfCompleted: vi.fn(),
}))

vi.mock('$lib/server/memory/event-reminder-schedule', () => ({
  syncReminderScheduleForEvent: vi.fn(),
  cancelReminderSchedulesForEvent: vi.fn(),
}))

vi.mock('$lib/server/memory/temporal-event-list', () => ({
  thoughtIdFromTaskItemId: (id: string) => (id.startsWith('task:') ? id.slice(5) : null),
  getTemporalEventListItemById: vi.fn(async () => ({
    id: EVENT_ID,
    itemType: 'event',
    kind: 'deadline',
    semanticSummary: 'Due',
    lifecycleStatus: 'archived',
    thoughtId: THOUGHT_ID,
  })),
}))

function chainSelect(results: unknown[][]) {
  let call = 0
  const nextRows = () => results[call++] ?? []
  mocks.getDb.mockReturnValue({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = nextRows()
          return {
            limit: vi.fn(async () => rows),
            then(
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (error: unknown) => unknown,
            ) {
              return Promise.resolve(rows).then(onFulfilled, onRejected)
            },
          }
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateCalls.push(values)
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: THOUGHT_ID, category: 'task' }]),
          })),
        }
      }),
    })),
  })
}

describe('lifecycle service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateCalls = []
    mocks.retireFacts.mockResolvedValue({ retired: [], revived: [] })
  })

  it('resolves task ids to thoughts', async () => {
    chainSelect([[{ id: THOUGHT_ID }]])
    await expect(resolveLifecycleTarget('u1', `task:${THOUGHT_ID}`)).resolves.toEqual({
      kind: 'thought',
      id: THOUGHT_ID,
    })
  })

  it('resolves temporal event uuid before thought uuid', async () => {
    chainSelect([[{ id: EVENT_ID }]])
    await expect(resolveLifecycleTarget('u1', EVENT_ID)).resolves.toEqual({
      kind: 'event',
      id: EVENT_ID,
    })
  })

  it('setThoughtLifecycleStatus writes lifecycle columns', async () => {
    chainSelect([
      [
        {
          id: THOUGHT_ID,
          userId: 'u1',
          normalizedText: 'Buy milk',
          metadata: {},
          category: 'task',
        },
      ],
      [],
    ])
    const result = await setThoughtLifecycleStatus('u1', THOUGHT_ID, 'completed')
    expect(result.ok).toBe(true)
    expect(mocks.updateCalls[0]).toMatchObject({
      lifecycleStatus: 'completed',
    })
  })

  describe('facts follow their source (docs/planning/user-facts-layer.md)', () => {
    const row = {
      id: THOUGHT_ID,
      userId: 'u1',
      normalizedText: 'I drink three coffees a day',
      metadata: {},
      category: 'task',
    }

    it('archiving a thought retires the facts it was the last live source of, after the status is written', async () => {
      chainSelect([[row], []])
      await setThoughtLifecycleStatus('u1', THOUGHT_ID, 'archived')
      expect(mocks.retireFacts).toHaveBeenCalledTimes(1)
      expect(mocks.retireFacts).toHaveBeenCalledWith('u1', THOUGHT_ID)
      // the thought row already says archived when the retirement looks at its sources
      expect(mocks.updateCalls[0]).toMatchObject({ lifecycleStatus: 'archived' })
    })

    it('completing or reopening a thought leaves its facts alone', async () => {
      chainSelect([[row], []])
      await setThoughtLifecycleStatus('u1', THOUGHT_ID, 'completed')
      chainSelect([[row], []])
      await setThoughtLifecycleStatus('u1', THOUGHT_ID, 'open')
      expect(mocks.retireFacts).not.toHaveBeenCalled()
    })

    it('a failing retirement fails the archive loudly: no silent fact left behind', async () => {
      chainSelect([[row], []])
      mocks.retireFacts.mockRejectedValue(new Error('retire failed'))
      await expect(setThoughtLifecycleStatus('u1', THOUGHT_ID, 'archived')).rejects.toThrow(
        /retire failed/,
      )
    })
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { assignThoughtToAgent } from './assign-thought'

const { getDbMock, emitAgentEventMock, loadProjectContextForThoughtMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  emitAgentEventMock: vi.fn(async () => ({ deliveries: 1 })),
  loadProjectContextForThoughtMock: vi.fn(async () => ({
    projectEntityIds: [] as string[],
    projectLabels: [] as string[],
  })),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('./emit', () => ({
  emitAgentEvent: emitAgentEventMock,
}))

vi.mock('./project-context', () => ({
  loadProjectContextForThought: loadProjectContextForThoughtMock,
}))

function makeSelectChain(rows: unknown[]) {
  const resolveRows = () => Promise.resolve(rows)
  const chain = {
    from: vi.fn((): typeof chain => chain),
    innerJoin: vi.fn((): typeof chain => chain),
    where: vi.fn((): typeof chain => chain),
    limit: vi.fn(resolveRows),
    then: (
      onfulfilled?: ((value: unknown[]) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) => resolveRows().then(onfulfilled, onrejected),
  }
  return chain
}

function makeDb(selectQueues: unknown[][]) {
  let selectIndex = 0
  return {
    select: vi.fn(() => makeSelectChain(selectQueues[selectIndex++] ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'assignment-1' }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
  }
}

describe('assignThoughtToAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProjectContextForThoughtMock.mockResolvedValue({
      projectEntityIds: [],
      projectLabels: [],
    })
  })

  it('creates assignment and emits agent.task.assigned webhook', async () => {
    getDbMock.mockImplementation(() =>
      makeDb([
        [{ id: 'agent-1', name: 'Hermes', enabled: true }],
        [
          {
            id: 'thought-1',
            normalizedText: 'Ship logo',
            category: 'task',
            memoryType: 'open_loop',
            lifecycleStatus: 'open',
          },
        ],
      ]),
    )

    const result = await assignThoughtToAgent({
      userId: 'u1',
      agentId: 'agent-1',
      thoughtId: 'thought-1',
    })

    expect(result).toMatchObject({
      assignmentId: 'assignment-1',
      agentId: 'agent-1',
      agentName: 'Hermes',
      thoughtId: 'thought-1',
      status: 'delivered',
    })
    expect(emitAgentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        agentId: 'agent-1',
        eventType: 'agent.task.assigned',
        eventId: 'assignment-1',
        payload: expect.objectContaining({
          assignmentId: 'assignment-1',
          thoughtId: 'thought-1',
          normalizedText: 'Ship logo',
        }),
      }),
    )
  })

  it('rejects disabled agent', async () => {
    getDbMock.mockImplementation(() =>
      makeDb([[{ id: 'agent-1', name: 'Hermes', enabled: false }]]),
    )

    await expect(
      assignThoughtToAgent({ userId: 'u1', agentId: 'agent-1', thoughtId: 'thought-1' }),
    ).rejects.toThrow('Connected agent is disabled')
  })

  it('rejects missing thought', async () => {
    getDbMock.mockImplementation(() =>
      makeDb([[{ id: 'agent-1', name: 'Hermes', enabled: true }], []]),
    )

    await expect(
      assignThoughtToAgent({ userId: 'u1', agentId: 'agent-1', thoughtId: 'thought-1' }),
    ).rejects.toThrow('Thought not found')
  })

  it('rejects non-task thoughts', async () => {
    getDbMock.mockImplementation(() =>
      makeDb([
        [{ id: 'agent-1', name: 'Hermes', enabled: true }],
        [
          {
            id: 'thought-1',
            normalizedText: 'A fact',
            category: 'fact',
            memoryType: null,
            lifecycleStatus: 'open',
          },
        ],
      ]),
    )

    await expect(
      assignThoughtToAgent({ userId: 'u1', agentId: 'agent-1', thoughtId: 'thought-1' }),
    ).rejects.toThrow('Only task thoughts can be assigned to agents')
  })

  it('rejects completed tasks', async () => {
    getDbMock.mockImplementation(() =>
      makeDb([
        [{ id: 'agent-1', name: 'Hermes', enabled: true }],
        [
          {
            id: 'thought-1',
            normalizedText: 'Done task',
            category: 'task',
            memoryType: 'open_loop',
            lifecycleStatus: 'completed',
          },
        ],
      ]),
    )

    await expect(
      assignThoughtToAgent({ userId: 'u1', agentId: 'agent-1', thoughtId: 'thought-1' }),
    ).rejects.toThrow('Only open tasks can be assigned to agents')
  })

  it('rejects when agent project bindings do not overlap thought projects', async () => {
    loadProjectContextForThoughtMock.mockResolvedValueOnce({
      projectEntityIds: ['proj-eigenmesh'],
      projectLabels: ['EigenMesh'],
    })

    getDbMock.mockImplementation(() =>
      makeDb([
        [{ id: 'agent-1', name: 'Hermes', enabled: true }],
        [
          {
            id: 'thought-1',
            normalizedText: 'Ship logo',
            category: 'task',
            memoryType: 'open_loop',
            lifecycleStatus: 'open',
          },
        ],
        [{ projectEntityId: 'proj-other' }],
      ]),
    )

    await expect(
      assignThoughtToAgent({ userId: 'u1', agentId: 'agent-1', thoughtId: 'thought-1' }),
    ).rejects.toThrow('Agent is not bound to any of the projects this thought belongs to')
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildEntityAuthorLayerIndex,
  serializeAuthorLayerIndex,
} from '$lib/server/graph/author-layers'
import { authorLayerKeyFromThought } from '$lib/server/memory/authorship'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

describe('author-layers helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authorLayerKeyFromThought maps api key agent to stable key', () => {
    expect(
      authorLayerKeyFromThought({
        author: 'agent',
        authorKeyId: '11111111-1111-4111-8111-111111111111',
        authorLabel: 'Cursor',
      }),
    ).toBe('apikey:11111111-1111-4111-8111-111111111111')
  })

  it('serializeAuthorLayerIndex sorts layer keys', () => {
    const index = new Map<string, Set<string>>([
      ['e1', new Set(['apikey:a', 'user'])],
      ['e2', new Set(['user'])],
    ])
    expect(serializeAuthorLayerIndex(index)).toEqual({
      e1: ['apikey:a', 'user'],
      e2: ['user'],
    })
  })

  it('buildEntityAuthorLayerIndex reads postgres-js array execute results', async () => {
    getDbMock.mockReturnValue({
      execute: vi.fn(async () => [
        {
          entity_id: 'e-agent',
          author: 'agent',
          author_key_id: '11111111-1111-4111-8111-111111111111',
          author_label: 'cursor',
        },
      ]),
    })

    const index = await buildEntityAuthorLayerIndex('u1')
    expect([...(index.get('e-agent') ?? [])]).toEqual([
      'apikey:11111111-1111-4111-8111-111111111111',
    ])
  })
})

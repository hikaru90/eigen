import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQueryEmbeddingCacheForTests } from '$lib/server/retrieval/embedding-cache'
import {
  createThoughtEmbedding,
  createThoughtEmbeddings,
  extractEmbeddings,
  extractFirstEmbedding,
} from './embedding'

const { llmCreateEmbeddingsMock, embeddingEnv } = vi.hoisted(() => ({
  llmCreateEmbeddingsMock: vi.fn(),
  embeddingEnv: { EMBEDDING_COMPRESS_INTENSITY: 'full' } as {
    EMBEDDING_COMPRESS_INTENSITY?: string
  },
}))

vi.mock('$env/dynamic/private', () => ({
  env: embeddingEnv,
}))

vi.mock('./llm-client', () => ({
  llmCreateEmbeddings: llmCreateEmbeddingsMock,
}))

describe('extractFirstEmbedding', () => {
  it('returns first embedding when response shape is valid', () => {
    const embedding = Array.from({ length: 1536 }, (_, i) => i / 1000)
    const result = extractFirstEmbedding({
      data: [{ embedding }],
    })
    expect(result).toHaveLength(1536)
    expect(result[0]).toBe(0)
    expect(result[10]).toBeCloseTo(0.01)
  })

  it('throws when data is missing', () => {
    expect(() => extractFirstEmbedding({})).toThrow(/empty data/)
  })

  it('throws when dimensions do not match expected size', () => {
    expect(() => extractFirstEmbedding({ data: [{ embedding: [1, 2, 3] }] })).toThrow(/dimensions/)
  })

  it('throws when top-level response is not object', () => {
    expect(() => extractFirstEmbedding(null)).toThrow(/not an object/)
  })

  it('throws when first item is invalid', () => {
    expect(() => extractFirstEmbedding({ data: [null] })).toThrow(/first item is invalid/)
  })

  it('throws when embedding contains non-numeric values', () => {
    expect(() =>
      extractFirstEmbedding({
        data: [{ embedding: Array.from({ length: 1536 }, (_, i) => (i === 2 ? 'x' : i)) }],
      }),
    ).toThrow(/non-numeric/)
  })

  it('throws when embedding payload is not an array', () => {
    expect(() => extractFirstEmbedding({ data: [{ embedding: 'oops' }] })).toThrow(
      /missing an embedding array/,
    )
  })
})

describe('createThoughtEmbedding', () => {
  beforeEach(() => {
    embeddingEnv.EMBEDDING_COMPRESS_INTENSITY = 'full'
    llmCreateEmbeddingsMock.mockReset()
    clearQueryEmbeddingCacheForTests()
  })

  it('calls embedding client with compressed input and parses first embedding', async () => {
    llmCreateEmbeddingsMock.mockResolvedValue({
      data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }],
    })
    const out = await createThoughtEmbedding('u1', 'hello')
    expect(out).toHaveLength(1536)
    expect(llmCreateEmbeddingsMock).toHaveBeenCalledTimes(1)
    const arg = llmCreateEmbeddingsMock.mock.calls[0][0] as { userId: string; input: string }
    expect(arg.userId).toBe('u1')
    expect(arg.input.length).toBeLessThanOrEqual('hello'.length)
  })

  it('sends shorter prose to the client for verbose input', async () => {
    llmCreateEmbeddingsMock.mockResolvedValue({
      data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }],
    })
    const verbose =
      'I think that basically we should really just simply add a refresh path when the session token expires.'
    await createThoughtEmbedding('u1', verbose)
    const arg = llmCreateEmbeddingsMock.mock.calls[0][0] as { input: string }
    expect(arg.input.length).toBeLessThan(verbose.length)
  })

  it('leaves a filesystem path segment intact inside the payload', async () => {
    llmCreateEmbeddingsMock.mockResolvedValue({
      data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }],
    })
    const text = 'Please look at the file /tmp/eigen/foo.txt for the configuration details.'
    await createThoughtEmbedding('u1', text)
    const arg = llmCreateEmbeddingsMock.mock.calls[0][0] as { input: string }
    expect(arg.input).toContain('/tmp/eigen/foo.txt')
  })

  it('throws when EMBEDDING_COMPRESS_INTENSITY is missing', async () => {
    delete embeddingEnv.EMBEDDING_COMPRESS_INTENSITY
    await expect(createThoughtEmbedding('u1', 'hello')).rejects.toThrow(
      /EMBEDDING_COMPRESS_INTENSITY/,
    )
  })

  it('throws when EMBEDDING_COMPRESS_INTENSITY is invalid', async () => {
    embeddingEnv.EMBEDDING_COMPRESS_INTENSITY = 'mega'
    await expect(createThoughtEmbedding('u1', 'hello')).rejects.toThrow(/lite, full, or ultra/)
  })

  it('reuses cache on second identical query', async () => {
    llmCreateEmbeddingsMock.mockResolvedValue({
      data: [{ embedding: Array.from({ length: 1536 }, () => 0.2) }],
    })
    await createThoughtEmbedding('u1', 'hello')
    await createThoughtEmbedding('u1', 'hello')
    expect(llmCreateEmbeddingsMock).toHaveBeenCalledTimes(1)
  })
})

describe('extractEmbeddings', () => {
  it('throws when response is not an object', () => {
    expect(() => extractEmbeddings(null)).toThrow(/not an object/)
  })

  it('throws when data array is empty', () => {
    expect(() => extractEmbeddings({ data: [] })).toThrow(/empty data/)
  })

  it('throws when a batch item is invalid', () => {
    expect(() =>
      extractEmbeddings({ data: [{ embedding: Array.from({ length: 1536 }, () => 0) }, null] }),
    ).toThrow(/item 1 is invalid/)
  })
})

describe('createThoughtEmbeddings', () => {
  beforeEach(() => {
    embeddingEnv.EMBEDDING_COMPRESS_INTENSITY = 'full'
    llmCreateEmbeddingsMock.mockReset()
    clearQueryEmbeddingCacheForTests()
  })

  it('batch embeds multiple texts in one gateway call', async () => {
    llmCreateEmbeddingsMock.mockResolvedValue({
      data: [
        { embedding: Array.from({ length: 1536 }, () => 0.1) },
        { embedding: Array.from({ length: 1536 }, () => 0.2) },
      ],
    })
    const out = await createThoughtEmbeddings('u1', ['hello', 'world'])
    expect(out).toHaveLength(2)
    expect(llmCreateEmbeddingsMock).toHaveBeenCalledTimes(1)
    expect((llmCreateEmbeddingsMock.mock.calls[0][0] as { input: string[] }).input).toHaveLength(2)
  })

  it('returns an empty array for zero inputs', async () => {
    await expect(createThoughtEmbeddings('u1', [])).resolves.toEqual([])
    expect(llmCreateEmbeddingsMock).not.toHaveBeenCalled()
  })

  it('delegates single-input batches to createThoughtEmbedding', async () => {
    llmCreateEmbeddingsMock.mockResolvedValue({
      data: [{ embedding: Array.from({ length: 1536 }, () => 0.3) }],
    })
    const out = await createThoughtEmbeddings('u1', ['solo'])
    expect(out).toHaveLength(1)
    expect(llmCreateEmbeddingsMock).toHaveBeenCalledTimes(1)
  })

  it('throws when gateway returns the wrong batch size', async () => {
    llmCreateEmbeddingsMock.mockResolvedValue({
      data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }],
    })
    await expect(createThoughtEmbeddings('u1', ['one', 'two'])).rejects.toThrow(
      /batch size mismatch/,
    )
  })
})

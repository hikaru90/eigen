import { describe, expect, it } from 'vitest'
import {
  isEmbeddingVectorArray,
  isVectorFieldName,
  sanitizeChatMessageContent,
  sanitizeChatMessages,
  sanitizeMcpToolResult,
  stripEmbeddingsFromValue,
} from './strip-embeddings'

const vec = () => Array.from({ length: 1536 }, (_, i) => i / 10_000)

describe('stripEmbeddingsFromValue', () => {
  it('removes embedding fields and 1536-dim numeric arrays', () => {
    const out = stripEmbeddingsFromValue({
      id: 't1',
      embedding: vec(),
      thought: { summaryEmbedding: vec(), label: 'ok' },
      scores: [0.1, 0.2],
    }) as Record<string, unknown>
    expect(out).toEqual({
      id: 't1',
      thought: { label: 'ok' },
      scores: [0.1, 0.2],
    })
  })

  it('drops top-level embedding arrays', () => {
    expect(stripEmbeddingsFromValue(vec())).toBeUndefined()
  })

  it('preserves short numeric arrays that are not embedding-sized', () => {
    expect(stripEmbeddingsFromValue([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('isEmbeddingVectorArray validates shape', () => {
    expect(isEmbeddingVectorArray(vec())).toBe(true)
    expect(isEmbeddingVectorArray([1, 2])).toBe(false)
  })

  it('rejects embedding-sized arrays with non-finite numbers', () => {
    const bad = vec()
    bad[100] = Number.NaN
    expect(isEmbeddingVectorArray(bad)).toBe(false)
  })

  it('passes through null, undefined, and primitives', () => {
    expect(stripEmbeddingsFromValue(null)).toBeNull()
    expect(stripEmbeddingsFromValue(undefined)).toBeUndefined()
    expect(stripEmbeddingsFromValue('plain')).toBe('plain')
    expect(stripEmbeddingsFromValue(42)).toBe(42)
  })

  it('drops embedding arrays nested in lists and empty nested values', () => {
    expect(stripEmbeddingsFromValue([vec(), 'keep'])).toEqual(['keep'])
    expect(stripEmbeddingsFromValue({ nested: vec() })).toEqual({})
  })

  it('isVectorFieldName matches exact and suffix field names', () => {
    expect(isVectorFieldName('embedding')).toBe(true)
    expect(isVectorFieldName('custom_embedding')).toBe(true)
    expect(isVectorFieldName('title')).toBe(false)
  })
})

describe('sanitizeMcpToolResult', () => {
  it('sanitizes nested list_thoughts payloads', () => {
    const out = sanitizeMcpToolResult({
      thoughts: [{ id: 't1', normalizedText: 'hi', embedding: vec() }],
    }) as { thoughts: Array<Record<string, unknown>> }
    expect(out.thoughts[0]).toEqual({ id: 't1', normalizedText: 'hi' })
  })
})

describe('sanitizeChatMessageContent', () => {
  it('strips embeddings from agent tool-result envelopes', () => {
    const content = `Tool result for list_thoughts:\n${JSON.stringify(
      { thoughts: [{ id: 't1', embedding: vec() }] },
      null,
      2,
    )}\n\nIf more tools are needed, call one now.`
    const sanitized = sanitizeChatMessageContent(content)
    expect(sanitized).not.toContain('"embedding"')
    expect(sanitized).toContain('t1')
  })

  it('returns envelope content unchanged when JSON is invalid', () => {
    const content =
      'Tool result for list_thoughts:\n{not json}\n\nIf more tools are needed, call one now.'
    expect(sanitizeChatMessageContent(content)).toBe(content)
  })

  it('strips embeddings from tool-result prefix without suffix envelope', () => {
    const content = `Tool result for search_thoughts:\n${JSON.stringify({
      thoughts: [{ id: 't2', embedding: vec() }],
    })}`
    const sanitized = sanitizeChatMessageContent(content)
    expect(sanitized).not.toContain('"embedding"')
    expect(sanitized).toContain('t2')
  })

  it('returns prefix-only tool content unchanged when JSON is invalid', () => {
    const content = 'Tool result for search_thoughts:\nnot-json'
    expect(sanitizeChatMessageContent(content)).toBe(content)
  })

  it('strips embeddings from standalone JSON message bodies', () => {
    const content = JSON.stringify({ id: 't3', embedding: vec() }, null, 2)
    const sanitized = sanitizeChatMessageContent(content)
    expect(sanitized).not.toContain('"embedding"')
    expect(sanitized).toContain('t3')
  })

  it('returns standalone invalid JSON unchanged', () => {
    const content = '{ invalid json '
    expect(sanitizeChatMessageContent(content)).toBe(content)
  })

  it('returns plain text unchanged', () => {
    const content = 'hello from the assistant'
    expect(sanitizeChatMessageContent(content)).toBe(content)
  })
})

describe('sanitizeChatMessages', () => {
  it('sanitizes each message content', () => {
    const messages = sanitizeChatMessages([
      {
        role: 'assistant',
        content: JSON.stringify({ embedding: vec(), id: 't4' }),
      },
    ])
    expect(messages[0].content).not.toContain('"embedding"')
    expect(messages[0].content).toContain('t4')
  })
})

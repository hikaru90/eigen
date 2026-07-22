import { describe, expect, it } from 'vitest'
import { parseLlmJsonPayload, stripMarkdownJsonFences } from './llm-json-content'

describe('stripMarkdownJsonFences', () => {
  it('removes json code fences', () => {
    const raw = '```json\n[{"surface":"next Wednesday"}]\n```'
    expect(stripMarkdownJsonFences(raw)).toBe('[{"surface":"next Wednesday"}]')
  })
})

describe('parseLlmJsonPayload', () => {
  it('parses fenced JSON payloads', () => {
    const parsed = parseLlmJsonPayload('```json\n{"ok":true}\n```')
    expect(parsed).toEqual({ ok: true })
  })
})

import { describe, expect, it } from 'vitest'
import {
  CHAT_TOOL_COPY,
  coerceToolResultSource,
  evidenceHitsFromAnswerQuestionPayload,
  formatToolArgumentsSummary,
  formatToolResultForDisplay,
  isToolResultFailed,
  parseComposedAnswerSections,
  parseFinalAnswerText,
  resolveToolResultView,
  sanitizeFinalAnswerText,
  toolCategoryClasses,
  toolVisual,
} from './chat-stream-types'
import { MCP_AGENT_TOOL_NAMES } from '$lib/server/mcp/registry'

describe('chat-stream-types', () => {
  it('assigns distinct categories per known tool', () => {
    expect(toolVisual('retrieve_thoughts').category).toBe('search')
    expect(toolVisual('capture_thought').category).toBe('write')
    expect(toolVisual('delete_thought').category).toBe('destructive')
    expect(toolCategoryClasses('search').icon).toContain('muted')
  })

  it('summarizes retrieve_thoughts query argument', () => {
    expect(
      formatToolArgumentsSummary('retrieve_thoughts', { query: 'how do I like my coffee' }),
    ).toBe('how do I like my coffee')
  })

  it('summarizes delete_thought thought_id argument', () => {
    expect(
      formatToolArgumentsSummary('delete_thought', {
        thought_id: '829b4cc7-ee30-403f-975b-f4663f52eb00',
      }),
    ).toBe('Thought 829b4cc7…')
  })

  it('formats tool error results for display', () => {
    const preview = JSON.stringify({ error: 'Thought not found' })
    expect(isToolResultFailed(preview)).toBe(true)
    expect(formatToolResultForDisplay('edit_thought', preview)).toBe('Error: Thought not found')
  })

  it('formats retrieve_thoughts hits as numbered list', () => {
    const preview = JSON.stringify({
      results: [{ normalizedText: 'i do like sweet coffee' }],
    })
    expect(formatToolResultForDisplay('retrieve_thoughts', preview)).toBe(
      '1. i do like sweet coffee',
    )
  })

  it('formats compact retrieve_thoughts candidates as numbered list', () => {
    const preview = JSON.stringify({
      count: 1,
      candidates: [{ id: 't1', snippet: 'i do like sweet coffee', category: 'thought' }],
    })
    expect(formatToolResultForDisplay('retrieve_thoughts', preview)).toBe(
      '1. i do like sweet coffee',
    )
  })

  it('parses list_thoughts snippet rows with ids into memory hits', () => {
    const raw = JSON.stringify({
      count: 2,
      thoughts: [
        { id: 't-home', snippet: 'Ich arbeite heute von zu Hause aus.', category: 'thought' },
        {
          id: 't-app',
          snippet: 'ich würde heute nachmittag gerne noch die app trennen',
          category: 'idea',
        },
      ],
    })
    const view = resolveToolResultView('list_thoughts', raw, raw)
    expect(view).toEqual({
      kind: 'memories',
      hits: [
        { id: 't-home', text: 'Ich arbeite heute von zu Hause aus.', category: 'thought' },
        {
          id: 't-app',
          text: 'ich würde heute nachmittag gerne noch die app trennen',
          category: 'idea',
        },
      ],
    })
  })

  it('parses raw JSON displaySummary into memory hits', () => {
    const raw = JSON.stringify({
      results: [
        {
          id: '829b4cc7-ee30-403f-975b-f4663f52eb00',
          normalizedText: 'i do like sweet coffee',
          category: 'emotion',
        },
      ],
    })
    const view = resolveToolResultView('retrieve_thoughts', raw, raw)
    expect(view).toEqual({
      kind: 'memories',
      hits: [
        {
          id: '829b4cc7-ee30-403f-975b-f4663f52eb00',
          text: 'i do like sweet coffee',
          category: 'emotion',
        },
      ],
    })
  })

  it('dedupes repeated memory hits by id and by text/category fallback', () => {
    const raw = JSON.stringify({
      results: [
        { id: 't1', normalizedText: 'Annie ist meine Schwester', category: 'reference' },
        { id: 't1', normalizedText: 'Annie ist meine Schwester', category: 'reference' },
        { normalizedText: 'Annie ist meine Schwester', category: 'reference' },
        { normalizedText: 'annie ist meine schwester', category: 'reference' },
      ],
    })
    const view = resolveToolResultView('retrieve_thoughts', raw, raw)
    expect(view).toEqual({
      kind: 'memories',
      hits: [{ id: 't1', text: 'Annie ist meine Schwester', category: 'reference' }],
    })
  })

  it('coerces jsonb object metadata into parseable memory hits', () => {
    const obj = {
      results: [{ normalizedText: 'ich mag kaffee', category: 'thought' }],
    }
    const view = resolveToolResultView('retrieve_thoughts', '', coerceToolResultSource(obj))
    expect(view).toEqual({
      kind: 'memories',
      hits: [{ text: 'ich mag kaffee', category: 'thought' }],
    })
  })

  it('salvages normalizedText from truncated legacy JSON', () => {
    const broken =
      '{"results":[{"id":"829b4cc7","normalizedText":"i do like sweet coffee","category":"emotion"},{"id":"5a9ca204","normalizedText":"ich mag kaffee"'
    const view = resolveToolResultView('retrieve_thoughts', broken, broken)
    expect(view).toEqual({
      kind: 'memories',
      hits: [
        { id: '829b4cc7', text: 'i do like sweet coffee', category: 'emotion' },
        { id: '5a9ca204', text: 'ich mag kaffee', category: undefined },
      ],
    })
  })

  it('parses evidence ids from [id=uuid] citations', () => {
    const raw =
      'Answer: You are home. [id=d2af9064-8fbe-490a-856a-ccaee8410516]\nEvidence:\n- You are working from home today. [id=d2af9064-8fbe-490a-856a-ccaee8410516]\nUnknown:\n- none'
    expect(parseComposedAnswerSections(raw).evidenceLines).toEqual([
      {
        text: 'You are working from home today.',
        id: 'd2af9064-8fbe-490a-856a-ccaee8410516',
      },
    ])
  })

  it('parses evidence ids from [<id=uuid>] citations', () => {
    const raw =
      'Answer: You are home. [<id=d2af9064-8fbe-490a-856a-ccaee8410516>]\nEvidence:\n- You are working from home today. [<id=d2af9064-8fbe-490a-856a-ccaee8410516>]\nUnknown:\n- none'
    expect(parseComposedAnswerSections(raw).evidenceLines).toEqual([
      {
        text: 'You are working from home today.',
        id: 'd2af9064-8fbe-490a-856a-ccaee8410516',
      },
    ])
  })

  it('parses composed answer sections without headers in final text', () => {
    const raw =
      'Answer: Annie ist deine Schwester. [id1]\n\nEvidence:\n- Annie ist meine Schwester [id1]\n\nUnknown:\n- none'
    expect(parseComposedAnswerSections(raw).answerText).toBe('Annie ist deine Schwester. [id1]')
    expect(parseComposedAnswerSections(raw).evidenceLines).toEqual([
      { text: 'Annie ist meine Schwester', id: 'id1' },
    ])
  })

  it('parseFinalAnswerText uses answer field from tool_result JSON', () => {
    const preview = JSON.stringify({
      answer:
        'Answer: Annie ist deine Schwester. [t1]\nEvidence:\n- Annie ist meine Schwester [t1]\nUnknown:\n- none',
      citations: ['t1'],
      retrieved: [{ id: 't1', normalizedText: 'Annie ist meine Schwester', category: 'reference' }],
    })
    expect(parseFinalAnswerText('ignored', preview)).toBe('Annie ist deine Schwester. [t1]')
    expect(evidenceHitsFromAnswerQuestionPayload(preview)).toEqual([
      { id: 't1', text: 'Annie ist meine Schwester', category: 'reference' },
    ])
  })

  it('shows only cited evidence for answer_question when retrieved has unrelated rows', () => {
    const preview = JSON.stringify({
      answer:
        'Answer: Whisk miso, mirin, and sake; marinate salmon then broil.\nEvidence:\n- Japanese Miso-Glazed Salmon recipe with miso glaze [salmon-id]\nUnknown:\n- none',
      citations: ['salmon-id'],
      retrieved: [
        {
          id: 'salmon-id',
          normalizedText:
            'Recipe: Japanese Miso-Glazed Salmon. Ingredients: four 6-oz salmon fillets…',
          category: 'observation',
        },
        { id: 'alex-1', normalizedText: 'ich bin alex', category: 'reference' },
        { id: 'alex-2', normalizedText: 'ich bin Alex', category: 'reference' },
        { id: 'annie-1', normalizedText: 'annie ist meine schwester', category: 'memory' },
      ],
    })
    expect(evidenceHitsFromAnswerQuestionPayload(preview)).toEqual([
      {
        id: 'salmon-id',
        text: 'Japanese Miso-Glazed Salmon recipe with miso glaze',
        category: 'observation',
      },
    ])
  })

  it('returns no evidence cards when answer has no Evidence lines', () => {
    const preview = JSON.stringify({
      answer: 'Answer: ok',
      retrieved: [{ id: 'a', normalizedText: 'memory hit', category: 'thought' }],
    })
    expect(evidenceHitsFromAnswerQuestionPayload(preview)).toEqual([])
  })

  it('allows duplicate profile citation ids in evidence rows', () => {
    const preview = JSON.stringify({
      answer:
        'Answer: You work in Hamburg. [profile]\nEvidence:\n- Work location: SPACE Hamburg [profile]\n- Role: founder [profile]\nUnknown:\n- none',
      retrieved: [{ id: 'profile', normalizedText: 'grounding', category: 'profile' }],
    })
    const hits = evidenceHitsFromAnswerQuestionPayload(preview)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits.every((h) => h.id === 'profile')).toBe(true)
  })

  it('parseFinalAnswerText extracts salmon answer prose from tool_result preview JSON', () => {
    const preview = JSON.stringify({
      answer:
        'Answer: To cook Japanese-Glazed Salmon, whisk a miso glaze, marinate salmon fillets for 30 minutes, then broil until caramelized and sprinkle with sesame seeds [id=be4377c5-97f1-4a52-9792-f0ff32c8369b].\n\nEvidence:\n- Recipe: Japanese Miso-Glazed Salmon. [id=be4377c5-97f1-4a52-9792-f0ff32c8369b]\n\nUnknown:\n- none',
      citations: ['be4377c5-97f1-4a52-9792-f0ff32c8369b'],
    })
    expect(parseFinalAnswerText('', preview)).toBe(
      'To cook Japanese-Glazed Salmon, whisk a miso glaze, marinate salmon fillets for 30 minutes, then broil until caramelized and sprinkle with sesame seeds [id=be4377c5-97f1-4a52-9792-f0ff32c8369b].',
    )
  })

  it('does not surface raw JSON as text for legacy payloads', () => {
    const raw = JSON.stringify({
      results: [{ normalizedText: 'i do like sweet coffee' }],
    })
    const view = resolveToolResultView('retrieve_thoughts', raw, raw)
    expect(view.kind).not.toBe('text')
    if (view.kind === 'text') expect(view.text).not.toContain('"results"')
  })

  it('lists human-readable copy for every agent tool', () => {
    for (const tool of MCP_AGENT_TOOL_NAMES) {
      expect(CHAT_TOOL_COPY[tool], `${tool} missing from CHAT_TOOL_COPY`).toBeDefined()
      expect(toolVisual(tool).title).not.toMatch(/Running\s+[a-z]+_/)
    }
    expect(MCP_AGENT_TOOL_NAMES).toEqual([
      'capture_thought',
      'answer_question',
      'retrieve_thoughts',
      'edit_thought',
      'delete_thought',
      'list_projects',
      'get_project_timeline',
      'order_task_in_project',
      'set_project_milestone',
      'set_project_deadline',
      'generate_project_plan',
      'create_project',
      'edit_project',
      'delete_project',
      'create_text_file',
      'list_text_files',
      'get_text_file',
      'update_text_file',
      'append_text_file',
      'delete_text_file',
      'search_text_files',
      'link_text_file_to_thought',
      'unlink_text_file_from_thought',
    ])
  })

  it('summarizes append_text_file arguments', () => {
    expect(
      formatToolArgumentsSummary('append_text_file', {
        text_file_id: 'abcdef12-3456-7890-abcd-ef1234567890',
        text: 'milk',
      }),
    ).toBe('Note abcdef12… · milk')
  })

  it('formats append_text_file result for display', () => {
    const preview = JSON.stringify({
      textFile: { title: 'Shopping', body: 'eggs\nmilk' },
    })
    expect(formatToolResultForDisplay('append_text_file', preview)).toBe('Shopping: eggs\nmilk')
  })

  it('falls back to unknown-tool visual for removed chat-only tools', () => {
    expect(toolVisual('list_temporal_events').title).toMatch(/Running list_temporal_events/)
  })

  it('summarizes create_text_file body argument', () => {
    expect(
      formatToolArgumentsSummary('create_text_file', { body: 'Shopping list: eggs, milk' }),
    ).toBe('Shopping list: eggs, milk')
  })

  it('formats create_text_file result for display', () => {
    const preview = JSON.stringify({
      textFileId: 'f1',
      textFile: { title: 'Shopping', body: 'eggs, milk' },
    })
    expect(formatToolResultForDisplay('create_text_file', preview)).toBe('Shopping: eggs, milk')
  })

  it('sanitizeFinalAnswerText rejects raw JSON tool payloads', () => {
    expect(() =>
      sanitizeFinalAnswerText('{"tool":"retrieve_thoughts","arguments":{"query":"x"}}'),
    ).toThrow(/unreadable data/i)
  })

  it('formatToolResultForDisplay never returns raw JSON for unknown tools', () => {
    const preview = JSON.stringify({
      tool: 'retrieve_thoughts',
      arguments: { query: 'x' },
    })
    expect(formatToolResultForDisplay('unknown_tool', preview)).toBe(
      'Could not read stored results for this step.',
    )
  })
})

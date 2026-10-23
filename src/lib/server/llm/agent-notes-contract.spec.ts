import { describe, expect, it } from 'vitest'
import { MCP_TOOL_DEFINITIONS } from '$lib/server/mcp/registry'
import { AGENT_SYSTEM_PROMPT } from './agent-loop'

describe('agent Notes contract', () => {
  it('requires search-then-append for additive note edits and forbids create for those requests', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/append_text_file/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/Never create_text_file for additive requests/i)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/add milk to my shopping list/)
    expect(AGENT_SYSTEM_PROMPT).toMatch(/Create a NEW note\/list only/)
    // ask surface is ask-only: the prompt never offers capture and notes are text documents
    expect(AGENT_SYSTEM_PROMPT).toMatch(/They are not memory thoughts/)
    expect(AGENT_SYSTEM_PROMPT).not.toMatch(/capture_thought/)
  })

  it('lists append_text_file in the agent tool description block', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('append_text_file')
    const append = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'append_text_file')
    expect(append?.description).toBeTruthy()
    expect(AGENT_SYSTEM_PROMPT).toContain(append!.description)
  })
})

import { describe, expect, it } from 'vitest'
import {
  isAgentTool,
  isMcpExposedTool,
  MCP_AGENT_TOOL_NAMES,
  MCP_CLIENT_EXPOSED_TOOL_NAMES,
  MCP_EXPOSED_TOOL_DEFINITIONS,
  MCP_TOOL_DEFINITIONS,
} from './registry'

const TEXT_NOTE_TOOLS = [
  'create_text_file',
  'list_text_files',
  'get_text_file',
  'update_text_file',
  'append_text_file',
  'delete_text_file',
  'search_text_files',
  'link_text_file_to_thought',
  'unlink_text_file_from_thought',
] as const

describe('MCP tool registry exposure', () => {
  it('exposes only the four client memory tools over HTTP MCP', () => {
    expect(MCP_CLIENT_EXPOSED_TOOL_NAMES).toEqual([
      'capture_thought',
      'retrieve_thoughts',
      'edit_thought',
      'delete_thought',
    ])
    expect(MCP_EXPOSED_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(MCP_CLIENT_EXPOSED_TOOL_NAMES)
  })

  it('gives the in-app chat agent thought CRUD plus text-note tools', () => {
    expect(MCP_AGENT_TOOL_NAMES).toEqual([...MCP_CLIENT_EXPOSED_TOOL_NAMES, ...TEXT_NOTE_TOOLS])
    expect(MCP_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(MCP_AGENT_TOOL_NAMES)
  })

  it('does not register removed chat-only tools', () => {
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('list_thoughts')
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('answer_question')
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('set_status')
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('list_temporal_events')
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('manage_temporal_event')
  })

  it('keeps text-note tools chat-only (not HTTP MCP)', () => {
    for (const name of TEXT_NOTE_TOOLS) {
      expect(isMcpExposedTool(name)).toBe(false)
      expect(isAgentTool(name)).toBe(true)
    }
  })

  it('isMcpExposedTool and isAgentTool gate the correct surfaces', () => {
    expect(isMcpExposedTool('capture_thought')).toBe(true)
    expect(isMcpExposedTool('create_text_file')).toBe(false)
    expect(isMcpExposedTool('list_thoughts')).toBe(false)
    expect(isMcpExposedTool('answer_question')).toBe(false)

    expect(isAgentTool('capture_thought')).toBe(true)
    expect(isAgentTool('retrieve_thoughts')).toBe(true)
    expect(isAgentTool('create_text_file')).toBe(true)
    expect(isAgentTool('delete_text_file')).toBe(true)
    expect(isAgentTool('list_thoughts')).toBe(false)
    expect(isAgentTool('answer_question')).toBe(false)
    expect(isAgentTool('nope')).toBe(false)
  })

  it('documents edit_thought status changes for MCP clients', () => {
    const edit = MCP_EXPOSED_TOOL_DEFINITIONS.find((t) => t.name === 'edit_thought')
    expect(edit?.description).toMatch(/mark complete/i)
    expect(edit?.description).toMatch(/archive/i)
    expect(edit?.description).toMatch(/set_status/i)
    expect(edit?.description).toMatch(/any category/i)
    expect(edit?.description).toMatch(/not a todo/i)

    const del = MCP_EXPOSED_TOOL_DEFINITIONS.find((t) => t.name === 'delete_thought')
    expect(del?.description).toMatch(/soft-remove/i)
    expect(del?.description).toMatch(/any category/i)
  })

  it('documents create_text_file as a Notes document, not a thought', () => {
    const create = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'create_text_file')
    expect(create?.description).toMatch(/not a thought/i)
    expect(create?.description).toMatch(/capture_thought/i)
    expect(create?.description).toMatch(/NEW/i)
    expect(create?.description).toMatch(/append_text_file/i)
    expect(create?.description).toMatch(/never use this to add items/i)
    expect(create?.inputSchema).not.toHaveProperty('required')
    expect(create?.agentArgumentSchema).toMatch(/title or body required/i)
  })

  it('documents append_text_file for additive list edits and keeps it chat-only', () => {
    const append = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'append_text_file')
    expect(append).toBeDefined()
    expect(append?.exposeInMcp).toBe(false)
    expect(append?.description).toMatch(/append/i)
    expect(append?.description).toMatch(/shopping lists/i)
    expect(append?.description).toMatch(/Do not create_text_file/i)
    expect(append?.inputSchema).toMatchObject({
      required: ['text_file_id', 'text'],
    })
    expect(isMcpExposedTool('append_text_file')).toBe(false)
    expect(isAgentTool('append_text_file')).toBe(true)
  })
})

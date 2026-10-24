import { describe, expect, it } from 'vitest'
import {
  buildChatAgentToolDescriptionBlock,
  CHAT_AGENT_TOOL_NAMES,
  isAgentTool,
  isChatAgentTool,
  isMcpExposedTool,
  MCP_AGENT_TOOL_NAMES,
  MCP_BOARD_TOOL_DEFINITIONS,
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

/** Multiplayer board (feature-multiplayer-board.md MB-7): HTTP MCP only, never the ask loop. */
const BOARD_TOOLS = ['list_board', 'share_idea', 'vote_idea', 'forget_idea'] as const

describe('MCP tool registry exposure', () => {
  it('keeps the shared board out of the ask/chat loop and the default MCP surface', () => {
    for (const name of BOARD_TOOLS) {
      expect(isMcpExposedTool(name)).toBe(false)
      expect(isChatAgentTool(name)).toBe(false)
    }
    expect(MCP_BOARD_TOOL_DEFINITIONS.map((t) => t.name)).toEqual([...BOARD_TOOLS])
  })

  it('exposes memory CRUD plus project timeline tools over HTTP MCP', () => {
    expect(MCP_CLIENT_EXPOSED_TOOL_NAMES).toEqual([
      'capture_thought',
      'retrieve_thoughts',
      'edit_thought',
      'delete_thought',
      'delete_thoughts_by_request',
      'list_projects',
      'open_threads',
      'get_project_timeline',
      'order_task_in_project',
      'set_project_milestone',
      'set_project_deadline',
      'generate_project_plan',
      'create_project',
      'edit_project',
      'delete_project',
    ])
    expect(MCP_EXPOSED_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(MCP_CLIENT_EXPOSED_TOOL_NAMES)
  })

  it('gives the in-app chat agent thought CRUD, grounded Q&A, project timeline, plus text-note tools', () => {
    expect(MCP_AGENT_TOOL_NAMES).toEqual([
      'capture_thought',
      'answer_question',
      'retrieve_thoughts',
      'edit_thought',
      'delete_thought',
      'delete_thoughts_by_request',
      'list_projects',
      'open_threads',
      'get_project_timeline',
      'order_task_in_project',
      'set_project_milestone',
      'set_project_deadline',
      'generate_project_plan',
      'create_project',
      'edit_project',
      'delete_project',
      ...BOARD_TOOLS,
      ...TEXT_NOTE_TOOLS,
    ])
    expect(MCP_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(MCP_AGENT_TOOL_NAMES)
  })

  it('excludes capture_thought from the ask/chat loop — asking never captures', () => {
    expect(CHAT_AGENT_TOOL_NAMES).not.toContain('capture_thought')
    expect(CHAT_AGENT_TOOL_NAMES).toContain('answer_question')
    expect(CHAT_AGENT_TOOL_NAMES).toContain('retrieve_thoughts')
    expect(CHAT_AGENT_TOOL_NAMES).toContain('edit_thought')
    expect(isChatAgentTool('capture_thought')).toBe(false)
    expect(isChatAgentTool('answer_question')).toBe(true)
    // capture stays registered and exposed for HTTP MCP clients / the Capture surface
    expect(isAgentTool('capture_thought')).toBe(true)
    expect(isMcpExposedTool('capture_thought')).toBe(true)
    // the catalog the ask model sees never offers capture
    const block = buildChatAgentToolDescriptionBlock()
    expect(block).not.toContain('capture_thought')
    expect(block).toContain('answer_question')
  })

  it('does not register removed chat-only tools', () => {
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('list_thoughts')
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('set_status')
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('list_temporal_events')
    expect(MCP_AGENT_TOOL_NAMES).not.toContain('manage_temporal_event')
  })

  it('keeps answer_question chat-only (not HTTP MCP)', () => {
    expect(MCP_AGENT_TOOL_NAMES).toContain('answer_question')
    expect(isAgentTool('answer_question')).toBe(true)
    expect(isMcpExposedTool('answer_question')).toBe(false)
    const def = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'answer_question')
    expect(def?.exposeInMcp).toBe(false)
    expect(def?.description).toMatch(/retrieving relevant thoughts/i)
    expect(def?.description).toMatch(/grounded answer/i)
    expect(def?.inputSchema).toMatchObject({ required: ['question'] })
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
    expect(isAgentTool('answer_question')).toBe(true)
    expect(isAgentTool('create_text_file')).toBe(true)
    expect(isAgentTool('delete_text_file')).toBe(true)
    expect(isAgentTool('list_thoughts')).toBe(false)
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

  it('exposes delete_thoughts_by_request as the Jev-gated natural-language delete', () => {
    const def = MCP_EXPOSED_TOOL_DEFINITIONS.find((t) => t.name === 'delete_thoughts_by_request')
    expect(def).toBeDefined()
    expect(def?.exposeInMcp).toBe(true)
    expect(isMcpExposedTool('delete_thoughts_by_request')).toBe(true)
    expect(isAgentTool('delete_thoughts_by_request')).toBe(true)
    expect(def?.description).toMatch(/soft-remove/i)
    expect(def?.description).toMatch(/natural-language request/i)
    expect(def?.description).toMatch(/Jev decision model/)
    expect(def?.description).toMatch(/0\.8 confidence gate/)
    expect(def?.description).toMatch(/ambiguous requests are rejected with an explicit error/)
    expect(def?.description).toMatch(/rather than deleting anything/)
    expect(def?.inputSchema).toMatchObject({
      type: 'object',
      properties: { request: { type: 'string' } },
      required: ['request'],
    })
  })

  it('documents create_text_file as a Notes document, not a thought', () => {
    const create = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'create_text_file')
    expect(create?.description).toMatch(/not a thought/i)
    // the ask catalog is capture-free: descriptions must not reference the removed tool
    expect(create?.description).not.toMatch(/capture_thought/i)
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

  it('documents askQuestion on recent browse of retrieve_thoughts (agent benchmark: one call)', () => {
    const retrieve = MCP_TOOL_DEFINITIONS.find((t) => t.name === 'retrieve_thoughts')
    expect(retrieve?.description).toMatch(/askQuestion/)
  })
})

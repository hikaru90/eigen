import { describe, expect, it, vi } from 'vitest'

const { handlerMap, runCaptureThoughtToolMock, runSearchThoughtsToolMock } = vi.hoisted(() => ({
  handlerMap: new Map(),
  runCaptureThoughtToolMock: vi.fn(),
  runSearchThoughtsToolMock: vi.fn(),
}))

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class MockServer {
    setRequestHandler(schema: unknown, handler: unknown) {
      handlerMap.set(schema, handler)
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: Symbol.for('list-tools'),
  CallToolRequestSchema: Symbol.for('call-tool'),
}))

vi.mock('./tools', () => ({
  runCaptureThoughtTool: runCaptureThoughtToolMock,
  runAnswerQuestionTool: vi.fn(),
  runEditThoughtTool: vi.fn(),
  runDeleteThoughtTool: vi.fn(),
  runRetrieveThoughtsTool: runSearchThoughtsToolMock,
  runCreateTextFileTool: vi.fn(),
  runListTextFilesTool: vi.fn(),
  runGetTextFileTool: vi.fn(),
  runUpdateTextFileTool: vi.fn(),
  runAppendTextFileTool: vi.fn(),
  runDeleteTextFileTool: vi.fn(),
  runSearchTextFilesTool: vi.fn(),
  runLinkTextFileToThoughtTool: vi.fn(),
  runUnlinkTextFileFromThoughtTool: vi.fn(),
  runListProjectsTool: vi.fn(),
  runGetProjectTimelineTool: vi.fn(),
  runOrderTaskInProjectTool: vi.fn(),
  runSetProjectMilestoneTool: vi.fn(),
  runSetProjectDeadlineTool: vi.fn(),
  runGenerateProjectPlanTool: vi.fn(),
}))

describe('createMcpServer', () => {
  it('registers list tools handler', async () => {
    const { createMcpServer } = await import('./server')
    createMcpServer({ userId: 'u1' })
    const listHandler = handlerMap.get(Symbol.for('list-tools')) as () => Promise<{
      tools: Array<{ name: string }>
    }>
    const result = await listHandler()
    expect(result.tools.map((t) => t.name)).toEqual([
      'capture_thought',
      'retrieve_thoughts',
      'edit_thought',
      'delete_thought',
      'list_projects',
      'get_project_timeline',
      'order_task_in_project',
      'set_project_milestone',
      'set_project_deadline',
      'generate_project_plan',
    ])
    expect(result.tools.map((t) => t.name)).not.toContain('list_thoughts')
    expect(result.tools.map((t) => t.name)).not.toContain('capture_grounding')
    expect(result.tools.map((t) => t.name)).not.toContain('complete_grounding_session')
  })

  it('rejects internal grounding tools on call', async () => {
    const { createMcpServer } = await import('./server')
    createMcpServer({ userId: 'u1' })
    const callHandler = handlerMap.get(Symbol.for('call-tool')) as (request: {
      params: { name: string; arguments?: unknown }
    }) => Promise<unknown>
    await expect(
      callHandler({ params: { name: 'capture_grounding', arguments: { facets: [] } } }),
    ).rejects.toThrow(/Unknown tool/)
  })

  it('dispatches call tool handler', async () => {
    runSearchThoughtsToolMock.mockResolvedValue({ results: [{ id: 't1' }] })
    const { createMcpServer } = await import('./server')
    createMcpServer({ userId: 'u1' })
    const callHandler = handlerMap.get(Symbol.for('call-tool')) as (request: {
      params: { name: string; arguments?: unknown }
    }) => Promise<{ content: Array<{ text: string }> }>
    const result = await callHandler({
      params: { name: 'retrieve_thoughts', arguments: { query: 'hello' } },
    })
    expect(runSearchThoughtsToolMock).toHaveBeenCalledWith({ userId: 'u1' }, { query: 'hello' })
    expect(result.content[0].text).toContain('results')
  })

  it('throws on unknown tool name', async () => {
    const { createMcpServer } = await import('./server')
    createMcpServer({ userId: 'u1' })
    const callHandler = handlerMap.get(Symbol.for('call-tool')) as (request: {
      params: { name: string; arguments?: unknown }
    }) => Promise<unknown>
    await expect(callHandler({ params: { name: 'nope' } })).rejects.toThrow(/Unknown tool/)
  })
})

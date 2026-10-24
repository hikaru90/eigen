import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  MCP_BOARD_ADMIN_TOOL_DEFINITIONS,
  MCP_BOARD_TOOL_DEFINITIONS,
  MCP_EXPOSED_TOOL_DEFINITIONS,
} from '$lib/server/mcp/registry'
import type { McpToolContext } from '$lib/server/mcp/tools'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'

export type McpServerAccess = {
  /** maker/admin only — see hasBoardMcpAccess. */
  boardAccess: boolean
  /** admin only — adds update_idea (status, note). */
  boardAdmin: boolean
}

export function createMcpServer(context: McpToolContext, access: McpServerAccess): Server {
  const tools = [
    ...MCP_EXPOSED_TOOL_DEFINITIONS,
    ...(access.boardAccess ? MCP_BOARD_TOOL_DEFINITIONS : []),
    ...(access.boardAccess && access.boardAdmin ? MCP_BOARD_ADMIN_TOOL_DEFINITIONS : []),
  ]
  const handlers = new Map(tools.map((tool) => [tool.name, tool.handler]))

  const server = new Server(
    {
      name: 'eigen-memory',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    const handler = handlers.get(name)
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`)
    }

    const result = sanitizeMcpToolResult(await handler(context, request.params.arguments ?? {}))
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
        },
      ],
    }
  })

  return server
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { MCP_EXPOSED_TOOL_DEFINITIONS, MCP_EXPOSED_TOOL_MAP } from '$lib/server/mcp/registry'
import type { McpToolContext } from '$lib/server/mcp/tools'
import { sanitizeMcpToolResult } from '$lib/server/observability/strip-embeddings'

export function createMcpServer(context: McpToolContext): Server {
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
    tools: MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    const handler = MCP_EXPOSED_TOOL_MAP.get(name)
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

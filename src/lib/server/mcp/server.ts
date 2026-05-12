import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
	runCaptureThoughtTool,
	runEditThoughtTool,
	runRetrieveThoughtsTool,
	runAnswerQuestionTool,
	type McpToolContext
} from '$lib/server/mcp/tools';

type ToolHandler = (context: McpToolContext, args: unknown) => Promise<unknown>;

const MCP_TOOLS = [
	{
		name: 'capture_thought',
		description: 'Capture and store a raw thought.',
		inputSchema: {
			type: 'object',
			properties: {
				raw: { type: 'string' }
			},
			required: ['raw']
		},
		handler: runCaptureThoughtTool
	},
	{
		name: 'retrieve_thoughts',
		description: 'Retrieve thoughts using hybrid vector, lexical, and graph retrieval.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				top_k: { type: 'number' },
				threshold: { type: 'number' }
			},
			required: ['query']
		},
		handler: runRetrieveThoughtsTool
	},
	{
		name: 'edit_thought',
		description: 'Apply a natural-language edit request to a thought.',
		inputSchema: {
			type: 'object',
			properties: {
				thought_id: { type: 'string' },
				edit_request: { type: 'string' }
			},
			required: ['thought_id', 'edit_request']
		},
		handler: runEditThoughtTool
	},
	{
		name: 'answer_question',
		description: 'Answer a question by retrieving relevant thoughts and composing a grounded answer.',
		inputSchema: {
			type: 'object',
			properties: {
				question: { type: 'string' },
				top_k: { type: 'number' }
			},
			required: ['question']
		},
		handler: runAnswerQuestionTool
	}
] as const;

const TOOL_MAP = new Map<string, ToolHandler>(MCP_TOOLS.map((tool) => [tool.name, tool.handler]));

export function createMcpServer(context: McpToolContext): Server {
	const server = new Server(
		{
			name: 'eigen-memory',
			version: '0.1.0'
		},
		{
			capabilities: {
				tools: {}
			}
		}
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: MCP_TOOLS.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema
		}))
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const name = request.params.name;
		const handler = TOOL_MAP.get(name);
		if (!handler) {
			throw new Error(`Unknown tool: ${name}`);
		}

		const result = await handler(context, request.params.arguments ?? {});
		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(result)
				}
			]
		};
	});

	return server;
}

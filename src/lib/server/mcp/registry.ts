import {
	runAnswerQuestionTool,
	runCaptureThoughtTool,
	runDeleteThoughtTool,
	runEditThoughtTool,
	runListThoughtsTool,
	runRetrieveThoughtsTool,
	type McpToolContext
} from '$lib/server/mcp/tools';

export type McpToolHandler = (context: McpToolContext, args: unknown) => Promise<unknown>;

export type McpToolDefinition = {
	name: string;
	description: string;
	/** JSON Schema for MCP ListTools / CallTool. */
	inputSchema: Record<string, unknown>;
	/** Human-readable argument summary for the chat agent system prompt. */
	agentArgumentSchema: string;
	handler: McpToolHandler;
};

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
	{
		name: 'capture_thought',
		description: 'Capture and store a raw thought (use when the user wants to remember something new).',
		inputSchema: {
			type: 'object',
			properties: {
				raw: { type: 'string' }
			},
			required: ['raw']
		},
		agentArgumentSchema: '{"raw": "string (required) — the text to store"}',
		handler: runCaptureThoughtTool
	},
	{
		name: 'list_thoughts',
		description: 'List recent stored thoughts (newest first), optionally paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'number' },
				cursor_created_at: { type: 'string' },
				cursor_id: { type: 'string' }
			}
		},
		agentArgumentSchema:
			'{"limit": "number (optional, default 20)", "cursor_created_at": "string (optional)", "cursor_id": "string (optional)"}',
		handler: runListThoughtsTool
	},
	{
		name: 'retrieve_thoughts',
		description:
			'Search stored thoughts using hybrid semantic, lexical, and graph retrieval — use first when the user reports doing something so you can match and update existing tasks or notes.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				top_k: { type: 'number' },
				threshold: { type: 'number' }
			},
			required: ['query']
		},
		agentArgumentSchema:
			'{"query": "string (required)", "top_k": "number (optional, default 20)", "threshold": "number (optional, 0-1)"}',
		handler: runRetrieveThoughtsTool
	},
	{
		name: 'edit_thought',
		description:
			'Edit an existing thought by ID with a natural-language request (updates, mark tasks complete, reword).',
		inputSchema: {
			type: 'object',
			properties: {
				thought_id: { type: 'string' },
				edit_request: { type: 'string' }
			},
			required: ['thought_id', 'edit_request']
		},
		agentArgumentSchema:
			'{"thought_id": "string (required)", "edit_request": "string (required) — e.g. mark complete, fix typo"}',
		handler: runEditThoughtTool
	},
	{
		name: 'delete_thought',
		description: 'Permanently delete a stored thought by ID.',
		inputSchema: {
			type: 'object',
			properties: {
				thought_id: { type: 'string' }
			},
			required: ['thought_id']
		},
		agentArgumentSchema: '{"thought_id": "string (required)"}',
		handler: runDeleteThoughtTool
	},
	{
		name: 'answer_question',
		description:
			'Answer a question by retrieving relevant thoughts and composing a grounded answer with citations.',
		inputSchema: {
			type: 'object',
			properties: {
				question: { type: 'string' },
				top_k: { type: 'number' }
			},
			required: ['question']
		},
		agentArgumentSchema: '{"question": "string (required)", "top_k": "number (optional)"}',
		handler: runAnswerQuestionTool
	}
];

export const MCP_TOOL_MAP = new Map<string, McpToolHandler>(
	MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler])
);

export const MCP_TOOL_NAMES = MCP_TOOL_DEFINITIONS.map((t) => t.name);

export function buildAgentToolDescriptionBlock(): string {
	return MCP_TOOL_DEFINITIONS.map(
		(t) => `- ${t.name}: ${t.description}\n  Arguments: ${t.agentArgumentSchema}`
	).join('\n\n');
}

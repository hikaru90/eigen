import {
	runCaptureThoughtTool,
	runDeleteThoughtTool,
	runEditThoughtTool,
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

/** Single MCP surface shared by HTTP clients and the in-app chat agent. */
export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
	{
		name: 'capture_thought',
		description:
			'Capture and store a raw thought. Tier 1: returns immediately after text persist; keyword recall on lexical_text is ready. Tier 2 (background): embedding, entities, graph links. Use retrieve_thoughts for recall. MCP Bearer auth: default labels the thought as agent-authored (your API key name). Pass as_user true when the user asked you to remember something for them (their memory, not yours). Omit as_user when storing the agent\'s own observation or note.',
		inputSchema: {
			type: 'object',
			properties: {
				raw: { type: 'string' },
				captured_at: {
					type: 'string',
					description: 'Optional ISO-8601 capture time for backdated memories (temporal anchoring).'
				},
				as_user: {
					type: 'boolean',
					description:
						'When true, store as the human user\'s memory (e.g. they asked you to remember this for them). When false or omitted on MCP API key auth, store as agent-authored with your API key name.'
				},
				author: {
					type: 'string',
					description:
						'Optional override: first ~10 characters of a different API key prefix to attribute authorship. Usually omitted — MCP Bearer token identity is used automatically.'
				}
			},
			required: ['raw']
		},
		agentArgumentSchema:
			'{"raw": "string (required)", "captured_at": "string (optional ISO-8601)", "as_user": "boolean (optional — true for human capture)", "author": "string (optional — rarely needed; MCP key labels automatically)"}',
		handler: runCaptureThoughtTool
	},
	{
		name: 'retrieve_thoughts',
		description:
			'Read stored thoughts. Defaults to user-authored open memories (excludes agent captures and completed/archived). For the latest open thoughts (newest first): omit query or set order=created_at — use top_k and optional cursor_created_at + cursor_id to paginate. With query and order=relevance (default): hybrid semantic, lexical, and graph search over open thoughts plus lexical search over attached text notes. Pass author=all or include_agent=true to include agent/API-key captures.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'Optional search text. Omit (or set order=created_at) to browse recent open thoughts newest-first instead of searching.'
				},
				order: {
					type: 'string',
					enum: ['created_at', 'relevance'],
					description:
						'created_at: newest open thoughts first (ignores query). relevance: rank by search match (default; requires query).'
				},
				top_k: {
					type: 'number',
					description: 'Max results (default 10). When browsing recent thoughts, acts as the page size.'
				},
				threshold: { type: 'number' },
				mode: { type: 'string', enum: ['fast', 'full'] },
				detail: { type: 'string', enum: ['snippet', 'full'] },
				author: {
					type: 'string',
					enum: ['user', 'agent', 'all'],
					description:
						'Whose memories to retrieve. Default user (human captures). agent = API-key captures only. all = no author filter.'
				},
				include_agent: {
					type: 'boolean',
					description: 'When true, same as author=all (ignored if author is set).'
				},
				cursor_created_at: {
					type: 'string',
					description: 'Pagination cursor (ISO created_at) when browsing recent thoughts without query.'
				},
				cursor_id: {
					type: 'string',
					description: 'Pagination cursor (thought UUID) when browsing recent thoughts without query.'
				}
			}
		},
		agentArgumentSchema:
			'{"query": "string (optional — omit for recent browse)", "order": "created_at|relevance (optional — created_at for newest open thoughts)", "top_k": "number (optional, default 10)", "threshold": "number (optional, 0-1)", "mode": "fast|full (optional)", "detail": "snippet|full (optional)", "author": "user|agent|all (optional, default user)", "include_agent": "boolean (optional — shorthand for author=all)", "cursor_created_at": "string (optional)", "cursor_id": "string (optional)"}',
		handler: runRetrieveThoughtsTool
	},
	{
		name: 'edit_thought',
		description:
			'Edit an existing thought by ID with a natural-language request. Covers text changes (reword, fix typo) and lifecycle/status changes (mark complete, mark done, reopen, archive, dismiss as irrelevant/outdated). Works for ANY category — task, idea, observation, fact, etc. are interchangeable; never refuse because something is "not a todo". Done/complete sets completed; archive/irrelevant/outdated soft-removes like delete_thought. There is no separate set_status tool.',
		inputSchema: {
			type: 'object',
			properties: {
				thought_id: { type: 'string' },
				edit_request: {
					type: 'string',
					description:
						'Natural-language instruction, e.g. "mark as done", "mark complete", "archive", "not relevant", "outdated", "fix typo in second sentence". Category does not matter.'
				},
				raw_text: {
					type: 'string',
					description:
						'Optional direct text replacement. When provided, replaces the thought text directly without LLM processing.'
				}
			},
			required: ['thought_id']
		},
		agentArgumentSchema:
			'{"thought_id": "string (required)", "edit_request": "string (optional) — text edits or status: mark as done, mark complete, archive, not relevant, outdated, reopen (any category)", "raw_text": "string (optional) — direct text replacement"}',
		handler: runEditThoughtTool
	},
	{
		name: 'delete_thought',
		description:
			'Archive (soft-remove) one stored thought by ID — reversible, not a permanent delete. Same soft-remove family as edit_thought "archive" / "not relevant" / "outdated"; use for delete/remove. Works for any category.',
		inputSchema: {
			type: 'object',
			properties: {
				thought_id: { type: 'string' }
			},
			required: ['thought_id']
		},
		agentArgumentSchema:
			'{"thought_id": "string (required) — UUID from retrieve_thoughts results, never a title or description"}',
		handler: runDeleteThoughtTool
	}
];

export const MCP_EXPOSED_TOOL_DEFINITIONS = MCP_TOOL_DEFINITIONS;

export const MCP_TOOL_MAP = new Map<string, McpToolHandler>(
	MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler])
);

export const MCP_EXPOSED_TOOL_MAP = MCP_TOOL_MAP;

/** Tools available to the in-app chat agent (same as HTTP MCP). */
export const MCP_AGENT_TOOL_NAMES = MCP_TOOL_DEFINITIONS.map((t) => t.name);

/** HTTP MCP client surface (minimal memory CRUD). */
export const MCP_CLIENT_EXPOSED_TOOL_NAMES = MCP_EXPOSED_TOOL_DEFINITIONS.map((t) => t.name);

export function isMcpExposedTool(name: string): boolean {
	return MCP_EXPOSED_TOOL_MAP.has(name);
}

export function isAgentTool(name: string): boolean {
	return MCP_EXPOSED_TOOL_MAP.has(name);
}

export function buildAgentToolDescriptionBlock(): string {
	return MCP_EXPOSED_TOOL_DEFINITIONS.map(
		(t) => `- ${t.name}: ${t.description}\n  Arguments: ${t.agentArgumentSchema}`
	).join('\n\n');
}

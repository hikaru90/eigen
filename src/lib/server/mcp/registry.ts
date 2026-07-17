import {
	runAppendTextFileTool,
	runCaptureThoughtTool,
	runCreateTextFileTool,
	runDeleteTextFileTool,
	runDeleteThoughtTool,
	runEditThoughtTool,
	runGetTextFileTool,
	runLinkTextFileToThoughtTool,
	runListTextFilesTool,
	runRetrieveThoughtsTool,
	runSearchTextFilesTool,
	runUnlinkTextFileFromThoughtTool,
	runUpdateTextFileTool,
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
	/** When false, tool is not exposed to HTTP MCP clients (in-app chat agent still has access). */
	exposeInMcp?: boolean;
};

const MCP_CLIENT_TOOL_NAMES = new Set([
	'capture_thought',
	'retrieve_thoughts',
	'edit_thought',
	'delete_thought'
]);

/**
 * Full tool surface for the in-app chat agent.
 * HTTP MCP clients only see tools with exposeInMcp !== false (the four thought CRUD tools).
 */
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
		handler: runCaptureThoughtTool,
		exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('capture_thought')
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
		handler: runRetrieveThoughtsTool,
		exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('retrieve_thoughts')
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
		handler: runEditThoughtTool,
		exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('edit_thought')
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
		handler: runDeleteThoughtTool,
		exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('delete_thought')
	},
	{
		name: 'create_text_file',
		description:
			'Create a NEW user-scoped text note (not a thought). Inserts a new Notes-tab document — never use this to add items to an existing list or amend a named note. For additive edits (e.g. add milk to shopping list), search_text_files or list_text_files, then append_text_file. Provide title and/or body (at least one required). Title-only is valid for empty new lists/notebooks. Do not use capture_thought for Notes documents.',
		inputSchema: {
			type: 'object',
			properties: {
				body: { type: 'string' },
				title: { type: 'string' },
				author: {
					type: 'string',
					description:
						'Optional first ~10 characters of your API key to attribute this note to that key name; leave empty to store as the user.'
				}
			}
		},
		agentArgumentSchema:
			'{"title": "string (optional)", "body": "string (optional)", "author": "string (optional) — first ~10 chars of your API key to label authorship; empty means user"} — at least one of title or body required',
		handler: runCreateTextFileTool,
		exposeInMcp: false
	},
	{
		name: 'list_text_files',
		description: 'List user text notes (newest updated first), optionally paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'number' },
				cursor_updated_at: { type: 'string' },
				cursor_id: { type: 'string' }
			}
		},
		agentArgumentSchema:
			'{"limit": "number (optional)", "cursor_updated_at": "string (optional ISO)", "cursor_id": "string (optional)"}',
		handler: runListTextFilesTool,
		exposeInMcp: false
	},
	{
		name: 'get_text_file',
		description: 'Get one user text note by ID.',
		inputSchema: {
			type: 'object',
			properties: {
				text_file_id: { type: 'string' }
			},
			required: ['text_file_id']
		},
		agentArgumentSchema: '{"text_file_id": "string (required)"}',
		handler: runGetTextFileTool,
		exposeInMcp: false
	},
	{
		name: 'update_text_file',
		description:
			'Replace a user text note title and/or full body. Prefer append_text_file when adding lines/items to an existing list or checklist.',
		inputSchema: {
			type: 'object',
			properties: {
				text_file_id: { type: 'string' },
				title: { type: 'string' },
				body: { type: 'string' }
			},
			required: ['text_file_id']
		},
		agentArgumentSchema:
			'{"text_file_id": "string (required)", "title": "string (optional)", "body": "string (optional)"}',
		handler: runUpdateTextFileTool,
		exposeInMcp: false
	},
	{
		name: 'append_text_file',
		description:
			'Append text to an existing Notes document (shopping lists, checklists, notebooks). Find text_file_id via search_text_files or list_text_files first. Do not create_text_file for additive requests.',
		inputSchema: {
			type: 'object',
			properties: {
				text_file_id: { type: 'string' },
				text: {
					type: 'string',
					description: 'Content to append (e.g. a list item).'
				},
				separator: {
					type: 'string',
					description:
						'Optional string between existing body and text. Default: newline when body is non-empty.'
				}
			},
			required: ['text_file_id', 'text']
		},
		agentArgumentSchema:
			'{"text_file_id": "string (required)", "text": "string (required)", "separator": "string (optional)"}',
		handler: runAppendTextFileTool,
		exposeInMcp: false
	},
	{
		name: 'delete_text_file',
		description: 'Permanently delete a user text note by ID.',
		inputSchema: {
			type: 'object',
			properties: {
				text_file_id: { type: 'string' }
			},
			required: ['text_file_id']
		},
		agentArgumentSchema: '{"text_file_id": "string (required)"}',
		handler: runDeleteTextFileTool,
		exposeInMcp: false
	},
	{
		name: 'search_text_files',
		description:
			'Lexical keyword search over user text notes (recipes, templates, pasted reference). Defaults to user-authored notes only. No embeddings — use retrieve_thoughts for hybrid thought + note search.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				top_k: { type: 'number' },
				author: {
					type: 'string',
					enum: ['user', 'agent', 'all'],
					description:
						'Whose notes to search. Default user (human). agent = API-key notes only. all = no author filter.'
				},
				include_agent: {
					type: 'boolean',
					description: 'When true, same as author=all (ignored if author is set).'
				}
			},
			required: ['query']
		},
		agentArgumentSchema:
			'{"query": "string (required)", "top_k": "number (optional)", "author": "user|agent|all (optional, default user)", "include_agent": "boolean (optional — shorthand for author=all)"}',
		handler: runSearchTextFilesTool,
		exposeInMcp: false
	},
	{
		name: 'link_text_file_to_thought',
		description: 'Attach an existing text note to a thought.',
		inputSchema: {
			type: 'object',
			properties: {
				thought_id: { type: 'string' },
				text_file_id: { type: 'string' }
			},
			required: ['thought_id', 'text_file_id']
		},
		agentArgumentSchema:
			'{"thought_id": "string (required)", "text_file_id": "string (required)"}',
		handler: runLinkTextFileToThoughtTool,
		exposeInMcp: false
	},
	{
		name: 'unlink_text_file_from_thought',
		description: 'Remove a text note attachment from a thought without deleting the note.',
		inputSchema: {
			type: 'object',
			properties: {
				thought_id: { type: 'string' },
				text_file_id: { type: 'string' }
			},
			required: ['thought_id', 'text_file_id']
		},
		agentArgumentSchema:
			'{"thought_id": "string (required)", "text_file_id": "string (required)"}',
		handler: runUnlinkTextFileFromThoughtTool,
		exposeInMcp: false
	}
];

export const MCP_EXPOSED_TOOL_DEFINITIONS = MCP_TOOL_DEFINITIONS.filter(
	(t) => t.exposeInMcp !== false
);

export const MCP_TOOL_MAP = new Map<string, McpToolHandler>(
	MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler])
);

export const MCP_EXPOSED_TOOL_MAP = new Map<string, McpToolHandler>(
	MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler])
);

/** All registered tools available to the in-app chat agent. */
export const MCP_AGENT_TOOL_NAMES = MCP_TOOL_DEFINITIONS.map((t) => t.name);

/** HTTP MCP client surface (minimal memory CRUD). */
export const MCP_CLIENT_EXPOSED_TOOL_NAMES = MCP_EXPOSED_TOOL_DEFINITIONS.map((t) => t.name);

export function isMcpExposedTool(name: string): boolean {
	return MCP_EXPOSED_TOOL_MAP.has(name);
}

export function isAgentTool(name: string): boolean {
	return MCP_TOOL_MAP.has(name);
}

export function buildAgentToolDescriptionBlock(): string {
	return MCP_TOOL_DEFINITIONS.map(
		(t) => `- ${t.name}: ${t.description}\n  Arguments: ${t.agentArgumentSchema}`
	).join('\n\n');
}

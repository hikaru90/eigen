import {
	runAnswerQuestionTool,
	runCaptureThoughtTool,
	runCreateTextFileTool,
	runDeleteTextFileTool,
	runDeleteThoughtTool,
	runEditThoughtTool,
	runGetTextFileTool,
	runLinkTextFileToThoughtTool,
	runListTextFilesTool,
	runListThoughtsTool,
	runListTemporalEventsTool,
	runManageTemporalEventTool,
	runSetStatusTool,
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
	/** When false, tool is not exposed to HTTP MCP clients (internal chat agent still has access). */
	exposeInMcp?: boolean;
};

const MCP_CLIENT_TOOL_NAMES = new Set([
	'capture_thought',
	'retrieve_thoughts',
	'edit_thought',
	'delete_thought'
]);

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
	{
		name: 'capture_thought',
		description:
			'Capture and store a raw thought. Tier 1: returns immediately after text persist; keyword recall on lexical_text is ready. Tier 2 (background): embedding, entities, graph links. Use answer_question or retrieve_thoughts for recall. MCP Bearer auth: default labels the thought as agent-authored (your API key name). Pass as_user true when the user asked you to remember something for them (their memory, not yours). Omit as_user when storing the agent\'s own observation or note.',
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
		name: 'list_thoughts',
		description: 'List recent stored thoughts (newest first), optionally paginated.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'number' },
				cursor_created_at: { type: 'string' },
				cursor_id: { type: 'string' },
				detail: { type: 'string', enum: ['snippet', 'full'] }
			}
		},
		agentArgumentSchema:
			'{"limit": "number (optional, default 20)", "cursor_created_at": "string (optional)", "cursor_id": "string (optional)", "detail": "snippet|full (optional, default snippet)"}',
		handler: runListThoughtsTool,
		exposeInMcp: false
	},
	{
		name: 'retrieve_thoughts',
		description:
			'Read stored thoughts. For the latest open thoughts (newest first, excludes completed/archived): omit query or set order=created_at — use top_k and optional cursor_created_at + cursor_id to paginate. With query and order=relevance (default): hybrid semantic, lexical, and graph search over open thoughts plus lexical search over attached text notes.',
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
			'{"query": "string (optional — omit for recent browse)", "order": "created_at|relevance (optional — created_at for newest open thoughts)", "top_k": "number (optional, default 10)", "threshold": "number (optional, 0-1)", "mode": "fast|full (optional)", "detail": "snippet|full (optional)", "cursor_created_at": "string (optional)", "cursor_id": "string (optional)"}',
		handler: runRetrieveThoughtsTool,
		exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('retrieve_thoughts')
	},
	{
		name: 'set_status',
		description:
			'Set lifecycle status on any memory item: thought UUID, task:{uuid}, or temporal event UUID. Use completed to mark done, archived to soft-remove from the active brain (not a hard delete).',
		inputSchema: {
			type: 'object',
			properties: {
				item_id: { type: 'string' },
				status: { type: 'string', enum: ['open', 'completed', 'archived'] }
			},
			required: ['item_id', 'status']
		},
		agentArgumentSchema:
			'{"item_id": "string (required) — thought UUID, task:{uuid}, or temporal event UUID", "status": "open|completed|archived (required)"}',
		handler: runSetStatusTool,
		exposeInMcp: false
	},
	{
		name: 'edit_thought',
		description:
			'Edit an existing thought by ID with a natural-language request. Covers text changes (reword, fix typo) and lifecycle/status changes (mark complete, mark done, reopen, archive). On MCP clients this is the tool for status updates — there is no separate set_status tool.',
		inputSchema: {
			type: 'object',
			properties: {
				thought_id: { type: 'string' },
				edit_request: {
					type: 'string',
					description:
						'Natural-language instruction, e.g. "mark complete", "archive this", "fix typo in second sentence".'
				}
			},
			required: ['thought_id', 'edit_request']
		},
		agentArgumentSchema:
			'{"thought_id": "string (required)", "edit_request": "string (required) — text edits or status: mark complete, archive, reopen"}',
		handler: runEditThoughtTool,
		exposeInMcp: MCP_CLIENT_TOOL_NAMES.has('edit_thought')
	},
	{
		name: 'delete_thought',
		description:
			'Archive (soft-remove) one stored thought by ID — reversible, not a permanent delete.',
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
		name: 'list_temporal_events',
		description:
			'List temporal events and tasks for the timeline (agenda, deadlines, appointments).',
		inputSchema: {
			type: 'object',
			properties: {
				range: {
					type: 'string',
					enum: ['relevant', 'upcoming', 'past', 'all']
				},
				status: { type: 'string', enum: ['open', 'all'] },
				include_tasks: { type: 'boolean' },
				include_open_loops: { type: 'boolean' }
			}
		},
		agentArgumentSchema:
			'{"range": "relevant|upcoming|past|all (optional)", "status": "open|all (optional)", "include_tasks": "boolean (optional, default true)"}',
		handler: runListTemporalEventsTool,
		exposeInMcp: false
	},
	{
		name: 'manage_temporal_event',
		description:
			'Manage a calendar/temporal event by ID: mark done, archive, reschedule, or apply a natural-language instruction.',
		inputSchema: {
			type: 'object',
			properties: {
				event_id: { type: 'string' },
				action: {
					type: 'string',
					enum: ['mark_done', 'reopen', 'archive', 'reschedule', 'snooze', 'cancel', 'dismiss', 'delete']
				},
				start_at: { type: 'string', description: 'ISO-8601 start for structured reschedule' },
				end_at: { type: 'string', description: 'ISO-8601 end for structured reschedule' },
				snoozed_until: { type: 'string', description: 'ISO-8601 instant for structured snooze' },
				instruction: {
					type: 'string',
					description: 'Natural-language instruction, e.g. move to tomorrow at 3pm'
				}
			},
			required: ['event_id']
		},
		agentArgumentSchema:
			'{"event_id": "string (required)", "action": "mark_done|reopen|archive (optional; cancel/dismiss/delete map to archive)", "instruction": "string (optional NL reschedule/snooze)"}',
		handler: runManageTemporalEventTool,
		exposeInMcp: false
	},
	{
		name: 'answer_question',
		description:
			'Answer a question by retrieving relevant thoughts and composing a grounded answer with citations.',
		inputSchema: {
			type: 'object',
			properties: {
				question: { type: 'string' },
				top_k: { type: 'number' },
				reference_time: {
					type: 'string',
					description: 'Optional ISO-8601 reference time for temporal validity (defaults to now).'
				}
			},
			required: ['question']
		},
		agentArgumentSchema:
			'{"question": "string (required)", "top_k": "number (optional)", "reference_time": "string (optional ISO-8601) — as-of time for temporal questions"}',
		handler: runAnswerQuestionTool,
		exposeInMcp: false
	},
	{
		name: 'create_text_file',
		description:
			'Create a user-scoped text note (not a thought). Text files are simple documents without enrichment; link them to thoughts with link_text_file_to_thought.',
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
			},
			required: ['body']
		},
		agentArgumentSchema:
			'{"body": "string (required)", "title": "string (optional)", "author": "string (optional) — first ~10 chars of your API key to label authorship; empty means user"}',
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
		description: 'Update a user text note title and/or body.',
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
			'Lexical keyword search over user text notes (recipes, templates, pasted reference). No embeddings — use retrieve_thoughts for hybrid thought + note search.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				top_k: { type: 'number' }
			},
			required: ['query']
		},
		agentArgumentSchema: '{"query": "string (required)", "top_k": "number (optional)"}',
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

export const MCP_EXPOSED_TOOL_DEFINITIONS = MCP_TOOL_DEFINITIONS.filter((t) => t.exposeInMcp !== false);

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

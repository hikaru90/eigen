import {
	runAnswerQuestionTool,
	runCaptureGroundingTool,
	runCaptureThoughtTool,
	runCompleteGroundingSessionTool,
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
	/** When false, tool is for in-app grounding chat only — not HTTP MCP clients. */
	exposeInMcp?: boolean;
};

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
	{
		name: 'capture_thought',
		description:
			'Capture and store a raw thought (use when the user wants to remember something new). Tier 1: returns immediately after text persist; keyword (full-text) recall on lexical_text is ready. Tier 2 (background): embedding, entities, graph links on the same row. Tier 3 (overnight): community summaries and bundles. Use answer_question or retrieve_thoughts for recall.',
		inputSchema: {
			type: 'object',
			properties: {
				raw: { type: 'string' },
				captured_at: {
					type: 'string',
					description: 'Optional ISO-8601 capture time for backdated memories (temporal anchoring).'
				}
			},
			required: ['raw']
		},
		agentArgumentSchema:
			'{"raw": "string (required) — the text to store", "captured_at": "string (optional ISO-8601) — when the memory occurred"}',
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
				cursor_id: { type: 'string' },
				detail: { type: 'string', enum: ['snippet', 'full'] }
			}
		},
		agentArgumentSchema:
			'{"limit": "number (optional, default 20)", "cursor_created_at": "string (optional)", "cursor_id": "string (optional)", "detail": "snippet|full (optional, default snippet)"}',
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
				threshold: { type: 'number' },
				mode: { type: 'string', enum: ['fast', 'full'] },
				detail: { type: 'string', enum: ['snippet', 'full'] }
			},
			required: ['query']
		},
		agentArgumentSchema:
			'{"query": "string (required)", "top_k": "number (optional, default 10)", "threshold": "number (optional, 0-1)", "mode": "fast|full (optional, default fast; relational queries auto-upgrade to full)", "detail": "snippet|full (optional, default snippet)"}',
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
		description: 'Permanently delete one stored thought by ID. For multiple deletions, call once per thought id.',
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
	},
	{
		name: 'list_temporal_events',
		description:
			'List temporal events and open-loop tasks for the timeline (agenda, deadlines, appointments).',
		inputSchema: {
			type: 'object',
			properties: {
				range: {
					type: 'string',
					enum: ['relevant', 'upcoming', 'past', 'all']
				},
				status: { type: 'string', enum: ['open', 'all'] },
				include_open_loops: { type: 'boolean' }
			}
		},
		agentArgumentSchema:
			'{"range": "relevant|upcoming|past|all (optional)", "status": "open|all (optional)", "include_open_loops": "boolean (optional, default true)"}',
		handler: runListTemporalEventsTool
	},
	{
		name: 'manage_temporal_event',
		description:
			'Manage a calendar/temporal event by ID: mark done, cancel, reschedule, or apply a natural-language instruction.',
		inputSchema: {
			type: 'object',
			properties: {
				event_id: { type: 'string' },
				action: {
					type: 'string',
					enum: ['mark_done', 'reopen', 'cancel', 'dismiss', 'delete', 'reschedule', 'snooze']
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
			'{"event_id": "string (required)", "action": "mark_done|reopen|cancel|dismiss|delete (optional)", "instruction": "string (optional NL reschedule/snooze)"}',
		handler: runManageTemporalEventTool
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
		handler: runAnswerQuestionTool
	},
	{
		name: 'create_text_file',
		description:
			'Create a user-scoped text note (not a thought). Text files are simple documents without enrichment; link them to thoughts with link_text_file_to_thought.',
		inputSchema: {
			type: 'object',
			properties: {
				body: { type: 'string' },
				title: { type: 'string' }
			},
			required: ['body']
		},
		agentArgumentSchema:
			'{"body": "string (required)", "title": "string (optional)"}',
		handler: runCreateTextFileTool
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
		handler: runListTextFilesTool
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
		handler: runGetTextFileTool
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
		handler: runUpdateTextFileTool
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
		handler: runDeleteTextFileTool
	},
	{
		name: 'search_text_files',
		description: 'Lexical keyword search over user text notes (not semantic thought retrieval).',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				top_k: { type: 'number' }
			},
			required: ['query']
		},
		agentArgumentSchema: '{"query": "string (required)", "top_k": "number (optional)"}',
		handler: runSearchTextFilesTool
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
		handler: runLinkTextFileToThoughtTool
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
		handler: runUnlinkTextFileFromThoughtTool
	},
	{
		name: 'capture_grounding',
		description:
			'Persist incremental user self-knowledge during a grounding conversation (work, identity, values, relationships, psychology, routines).',
		inputSchema: {
			type: 'object',
			properties: {
				facets: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							key: { type: 'string' },
							content: { type: 'string' }
						},
						required: ['key', 'content']
					}
				},
				session_note: { type: 'string' }
			},
			required: ['facets']
		},
		agentArgumentSchema:
			'{"facets": [{"key": "work|identity|values|relationships|psychology|routines|projects", "content": "string"}], "session_note": "string (optional)"}',
		handler: runCaptureGroundingTool,
		exposeInMcp: false
	},
	{
		name: 'complete_grounding_session',
		description:
			'Mark the grounding conversation complete when enough self-knowledge has been captured. Unlocks capture for first-time users.',
		inputSchema: {
			type: 'object',
			properties: {
				synthesis: {
					type: 'string',
					description: 'Optional final portrait paragraph summarizing the user.'
				}
			}
		},
		agentArgumentSchema: '{"synthesis": "string (optional) — final user portrait"}',
		handler: runCompleteGroundingSessionTool,
		exposeInMcp: false
	}
];

export const GROUNDING_TOOL_NAMES = ['capture_grounding', 'complete_grounding_session'] as const;

export const MCP_EXPOSED_TOOL_DEFINITIONS = MCP_TOOL_DEFINITIONS.filter((t) => t.exposeInMcp !== false);

export const MCP_TOOL_MAP = new Map<string, McpToolHandler>(
	MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler])
);

export const MCP_EXPOSED_TOOL_MAP = new Map<string, McpToolHandler>(
	MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler])
);

export const MCP_TOOL_NAMES = MCP_EXPOSED_TOOL_DEFINITIONS.map((t) => t.name);

export function isMcpExposedTool(name: string): boolean {
	return MCP_EXPOSED_TOOL_MAP.has(name);
}

export function buildAgentToolDescriptionBlock(): string {
	return MCP_EXPOSED_TOOL_DEFINITIONS.map(
		(t) => `- ${t.name}: ${t.description}\n  Arguments: ${t.agentArgumentSchema}`
	).join('\n\n');
}

export function buildGroundingAgentToolDescriptionBlock(): string {
	return MCP_TOOL_DEFINITIONS.filter((t) =>
		(GROUNDING_TOOL_NAMES as readonly string[]).includes(t.name)
	)
		.map((t) => `- ${t.name}: ${t.description}\n  Arguments: ${t.agentArgumentSchema}`)
		.join('\n\n');
}

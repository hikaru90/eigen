import {
	runAnswerQuestionTool,
	runCaptureGroundingTool,
	runCaptureThoughtTool,
	runCompleteGroundingSessionTool,
	runDeleteThoughtTool,
	runEditThoughtTool,
	runListThoughtsTool,
	runManageTemporalEventTool,
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
		name: 'manage_temporal_event',
		description:
			'Manage a calendar/temporal event by ID: mark done, cancel, reschedule, or apply a natural-language instruction.',
		inputSchema: {
			type: 'object',
			properties: {
				event_id: { type: 'string' },
				action: {
					type: 'string',
					enum: ['mark_done', 'reopen', 'cancel', 'dismiss', 'delete']
				},
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
			'{"facets": [{"key": "work|identity|values|relationships|psychology|routines", "content": "string"}], "session_note": "string (optional)"}',
		handler: runCaptureGroundingTool
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
		handler: runCompleteGroundingSessionTool
	}
];

export const GROUNDING_TOOL_NAMES = ['capture_grounding', 'complete_grounding_session'] as const;

export const MCP_TOOL_MAP = new Map<string, McpToolHandler>(
	MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool.handler])
);

export const MCP_TOOL_NAMES = MCP_TOOL_DEFINITIONS.map((t) => t.name);

export function buildAgentToolDescriptionBlock(): string {
	return MCP_TOOL_DEFINITIONS.map(
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
